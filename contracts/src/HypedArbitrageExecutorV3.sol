// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    IERC20Minimal,
    IWETHMinimal,
    IMintClubBond,
    IUniswapOnchainRouter,
    RouterSwapParams,
    Quote
} from "./HypedArbitrageExecutor.sol";

/// @notice Repeatedly executes the best profitable Reserve -> Hyped Token -> Reserve route.
/// @dev User funds remain in the user's wallet between executions. The cumulative Reserve Token
///      volume and ERC-20 allowance bound the total amount that can be used until the owner stops.
contract HypedArbitrageExecutorV3 {
    uint256 public constant BPS = 10_000;
    uint16 public constant protocolFeeBps = 0;
    uint16 public constant executorRewardBps = 2_000;

    enum Direction {
        MintThenSell,
        BuyThenRedeem
    }

    struct Strategy {
        address owner;
        address hToken;
        address reserveToken;
        uint40 validUntil;
        bool active;
        uint64 executionCount;
        uint64 lastExecutionBlock;
        uint256 maxReservePerExecution;
        uint256 remainingVolume;
        uint256 minProfitReserve;
    }

    struct ExecutionParams {
        uint256 amountInReserve;
        uint256 hAmountForMint;
        uint256 minimumWethOut;
        uint256 minimumHypedOut;
        uint256 minimumBondOut;
        uint256 minimumReserveOut;
    }

    error Reentered();
    error ZeroAddress();
    error InvalidConfiguration();
    error UnknownMintClubToken();
    error StrategyAlreadyActive();
    error NotStrategyOwner();
    error StrategyInactive();
    error StrategyExpired();
    error AmountOutsidePermission();
    error AlreadyExecutedThisBlock();
    error MinimumProfitNotMet(uint256 actualProfit, uint256 requiredProfit);
    error MissingRoute();
    error UnsupportedTokenTransfer(address token, uint256 expected, uint256 received);
    error TokenCallFailed(address token);

    event StrategyStarted(
        uint256 indexed strategyId,
        address indexed owner,
        address indexed hToken,
        address reserveToken,
        uint256 maxReservePerExecution,
        uint256 totalVolume,
        uint256 minProfitReserve,
        uint40 validUntil
    );
    event StrategyStopped(uint256 indexed strategyId, address indexed owner);
    event ArbitrageExecuted(
        uint256 indexed strategyId,
        address indexed owner,
        address indexed executor,
        Direction direction,
        address reserveToken,
        uint256 amountInReserve,
        uint256 amountReturnedReserve,
        uint256 grossProfitReserve,
        uint256 protocolFeeReserve,
        uint256 executorRewardReserve,
        uint256 ownerProfitReserve,
        uint256 remainingVolume,
        uint64 executionCount
    );

    address public immutable weth;
    IMintClubBond public immutable mintClubBond;
    IUniswapOnchainRouter public immutable onchainRouter;

    uint256 public strategyCount;
    mapping(uint256 strategyId => Strategy strategy) public strategies;
    mapping(address owner => mapping(address reserveToken => uint256 strategyId)) public
        activeStrategyId;
    uint256 private locked = 1;

    modifier nonReentrant() {
        if (locked != 1) revert Reentered();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address weth_, address mintClubBond_, address onchainRouter_) {
        if (weth_ == address(0) || mintClubBond_ == address(0) || onchainRouter_ == address(0)) {
            revert ZeroAddress();
        }
        weth = weth_;
        mintClubBond = IMintClubBond(mintClubBond_);
        onchainRouter = IUniswapOnchainRouter(onchainRouter_);
    }

    receive() external payable { }

    /// @param validUntil Zero keeps the authorization active until the owner stops it.
    function startStrategy(
        address hToken,
        uint256 maxReservePerExecution,
        uint256 totalVolume,
        uint256 minProfitReserve,
        uint40 validUntil
    ) external returns (uint256 strategyId) {
        if (
            hToken == address(0) || maxReservePerExecution == 0 || totalVolume == 0
                || maxReservePerExecution > totalVolume || minProfitReserve == 0
                || (validUntil != 0 && validUntil <= block.timestamp)
        ) revert InvalidConfiguration();

        (,,,, address reserveToken,) = mintClubBond.tokenBond(hToken);
        if (reserveToken == address(0)) revert UnknownMintClubToken();
        if (reserveToken == weth || reserveToken == hToken || hToken == weth) {
            revert InvalidConfiguration();
        }
        if (hToken.code.length == 0 || reserveToken.code.length == 0) {
            revert InvalidConfiguration();
        }

        uint256 existingStrategyId = activeStrategyId[msg.sender][reserveToken];
        if (existingStrategyId != 0) {
            Strategy memory existing = strategies[existingStrategyId];
            bool unexpired = existing.validUntil == 0 || block.timestamp <= existing.validUntil;
            if (existing.active && unexpired && existing.remainingVolume > 0) {
                revert StrategyAlreadyActive();
            }
        }

        strategyId = ++strategyCount;
        strategies[strategyId] = Strategy({
            owner: msg.sender,
            hToken: hToken,
            reserveToken: reserveToken,
            validUntil: validUntil,
            active: true,
            executionCount: 0,
            lastExecutionBlock: 0,
            maxReservePerExecution: maxReservePerExecution,
            remainingVolume: totalVolume,
            minProfitReserve: minProfitReserve
        });
        activeStrategyId[msg.sender][reserveToken] = strategyId;

        emit StrategyStarted(
            strategyId,
            msg.sender,
            hToken,
            reserveToken,
            maxReservePerExecution,
            totalVolume,
            minProfitReserve,
            validUntil
        );
    }

    function stopStrategy(uint256 strategyId) external {
        Strategy storage strategy = strategies[strategyId];
        if (strategy.owner != msg.sender) revert NotStrategyOwner();
        if (!strategy.active) revert StrategyInactive();
        _deactivate(strategyId, strategy);
    }

    /// @notice Atomically returns Reserve principal and protected profit or reverts everything.
    function execute(uint256 strategyId, Direction direction, ExecutionParams calldata params)
        external
        nonReentrant
        returns (uint256 ownerReturnReserve)
    {
        Strategy storage stored = strategies[strategyId];
        if (!stored.active || stored.owner == address(0)) revert StrategyInactive();
        if (stored.validUntil != 0 && block.timestamp > stored.validUntil) {
            revert StrategyExpired();
        }
        if (stored.lastExecutionBlock == block.number) revert AlreadyExecutedThisBlock();
        if (
            params.amountInReserve == 0 || params.amountInReserve > stored.maxReservePerExecution
                || params.amountInReserve > stored.remainingVolume
        ) revert AmountOutsidePermission();

        Strategy memory strategy = stored;
        (,,,, address currentReserveToken,) = mintClubBond.tokenBond(strategy.hToken);
        if (currentReserveToken != strategy.reserveToken) revert InvalidConfiguration();

        uint256 reserveBefore = _balance(strategy.reserveToken);
        uint256 hBefore = _balance(strategy.hToken);
        uint256 wethBefore = _balance(weth);
        _safeTransferFrom(
            strategy.reserveToken, strategy.owner, address(this), params.amountInReserve
        );
        uint256 reserveReceived = _balance(strategy.reserveToken) - reserveBefore;
        if (reserveReceived != params.amountInReserve) {
            revert UnsupportedTokenTransfer(
                strategy.reserveToken, params.amountInReserve, reserveReceived
            );
        }

        if (direction == Direction.MintThenSell) {
            _mintThenSell(strategy, params, reserveBefore, hBefore);
        } else {
            _buyThenRedeem(strategy, params, reserveBefore, hBefore);
        }

        uint256 amountReturnedReserve = _balance(strategy.reserveToken) - reserveBefore;
        uint256 grossProfitReserve = amountReturnedReserve > params.amountInReserve
            ? amountReturnedReserve - params.amountInReserve
            : 0;
        uint256 protocolFeeReserve = 0;
        uint256 executorRewardReserve = grossProfitReserve * executorRewardBps / BPS;
        uint256 ownerProfitReserve = grossProfitReserve - protocolFeeReserve - executorRewardReserve;
        if (ownerProfitReserve < strategy.minProfitReserve) {
            revert MinimumProfitNotMet(ownerProfitReserve, strategy.minProfitReserve);
        }
        ownerReturnReserve = params.amountInReserve + ownerProfitReserve;

        if (executorRewardReserve > 0) {
            _safeTransfer(strategy.reserveToken, msg.sender, executorRewardReserve);
        }
        _safeTransfer(strategy.reserveToken, strategy.owner, ownerReturnReserve);
        _returnProducedDust(strategy.hToken, strategy.owner, hBefore);
        _returnProducedDust(weth, strategy.owner, wethBefore);

        stored.remainingVolume -= params.amountInReserve;
        stored.executionCount += 1;
        stored.lastExecutionBlock = uint64(block.number);

        emit ArbitrageExecuted(
            strategyId,
            strategy.owner,
            msg.sender,
            direction,
            strategy.reserveToken,
            params.amountInReserve,
            amountReturnedReserve,
            grossProfitReserve,
            protocolFeeReserve,
            executorRewardReserve,
            ownerProfitReserve,
            stored.remainingVolume,
            stored.executionCount
        );

        if (stored.remainingVolume == 0) {
            _deactivate(strategyId, stored);
        }
    }

    function _deactivate(uint256 strategyId, Strategy storage strategy) private {
        strategy.active = false;
        if (activeStrategyId[strategy.owner][strategy.reserveToken] == strategyId) {
            delete activeStrategyId[strategy.owner][strategy.reserveToken];
        }
        emit StrategyStopped(strategyId, strategy.owner);
    }

    function _mintThenSell(
        Strategy memory strategy,
        ExecutionParams calldata params,
        uint256 reserveBefore,
        uint256 hBefore
    ) private {
        if (params.hAmountForMint == 0) {
            revert AmountOutsidePermission();
        }
        (uint256 reserveRequired,) =
            mintClubBond.getReserveForToken(strategy.hToken, params.hAmountForMint);
        if (reserveRequired > params.amountInReserve) revert AmountOutsidePermission();

        _approveExact(strategy.reserveToken, address(mintClubBond), reserveRequired);
        mintClubBond.mint(strategy.hToken, params.hAmountForMint, reserveRequired, address(this));
        _approveExact(strategy.reserveToken, address(mintClubBond), 0);

        uint256 hProduced = _balance(strategy.hToken) - hBefore;
        uint256 wethOut = _swap(strategy.hToken, weth, hProduced, params.minimumWethOut);
        _swap(weth, strategy.reserveToken, wethOut, params.minimumReserveOut);
        if (_balance(strategy.reserveToken) < reserveBefore) {
            revert UnsupportedTokenTransfer(strategy.reserveToken, reserveBefore, 0);
        }
    }

    function _buyThenRedeem(
        Strategy memory strategy,
        ExecutionParams calldata params,
        uint256 reserveBefore,
        uint256 hBefore
    ) private {
        uint256 wethOut = _swap(
            strategy.reserveToken, weth, params.amountInReserve, params.minimumWethOut
        );
        uint256 hOut = _swap(weth, strategy.hToken, wethOut, params.minimumHypedOut);
        _approveExact(strategy.hToken, address(mintClubBond), hOut);
        uint256 reserveImmediatelyBeforeBurn = _balance(strategy.reserveToken);
        mintClubBond.burn(strategy.hToken, hOut, params.minimumBondOut, address(this));
        _approveExact(strategy.hToken, address(mintClubBond), 0);

        uint256 reserveFromBond = _balance(strategy.reserveToken) - reserveImmediatelyBeforeBurn;
        if (reserveFromBond < params.minimumReserveOut) revert MissingRoute();
        if (_balance(strategy.hToken) < hBefore || _balance(strategy.reserveToken) < reserveBefore)
        {
            revert MissingRoute();
        }
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimumOut)
        private
        returns (uint256 amountOut)
    {
        if (amountIn == 0 || minimumOut == 0) revert MissingRoute();
        uint256 tokenOutBefore = _balance(tokenOut);
        uint256 nativeBefore = address(this).balance;
        Quote memory quote = onchainRouter.routeExactInput(
            RouterSwapParams({ tokenIn: tokenIn, tokenOut: tokenOut, amountSpecified: amountIn })
        );
        if (quote.path.length == 0 || quote.amountOut < minimumOut) revert MissingRoute();
        quote.amountOut = minimumOut;
        _approveExact(tokenIn, address(onchainRouter), amountIn);
        onchainRouter.swapExactInput(quote, address(this), block.timestamp, false);
        _approveExact(tokenIn, address(onchainRouter), 0);
        _wrapNativeReceived(nativeBefore);

        amountOut = _balance(tokenOut) - tokenOutBefore;
        if (amountOut < minimumOut) revert MissingRoute();
    }

    function _returnProducedDust(address token, address recipient, uint256 balanceBefore) private {
        uint256 currentBalance = _balance(token);
        if (currentBalance > balanceBefore) {
            _safeTransfer(token, recipient, currentBalance - balanceBefore);
        }
    }

    function _wrapNativeReceived(uint256 nativeBefore) private {
        uint256 nativeAfter = address(this).balance;
        if (nativeAfter > nativeBefore) {
            IWETHMinimal(weth).deposit{ value: nativeAfter - nativeBefore }();
        }
    }

    function _balance(address token) private view returns (uint256) {
        return IERC20Minimal(token).balanceOf(address(this));
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        _callOptionalReturn(token, abi.encodeCall(IERC20Minimal.approve, (spender, 0)));
        if (amount > 0) {
            _callOptionalReturn(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
        }
    }

    function _safeTransfer(address token, address recipient, uint256 amount) private {
        _callOptionalReturn(token, abi.encodeCall(IERC20Minimal.transfer, (recipient, amount)));
    }

    function _safeTransferFrom(address token, address sender, address recipient, uint256 amount)
        private
    {
        _callOptionalReturn(
            token, abi.encodeCall(IERC20Minimal.transferFrom, (sender, recipient, amount))
        );
    }

    function _callOptionalReturn(address token, bytes memory data) private {
        if (token.code.length == 0) revert TokenCallFailed(token);
        (bool success, bytes memory result) = token.call(data);
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenCallFailed(token);
        }
    }
}
