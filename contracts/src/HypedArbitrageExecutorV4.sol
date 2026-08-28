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

/// @notice Executes a Mint Club arbitrage only when the owner keeps principal,
///         the relay is reimbursed for Base transaction fees, and the protected
///         owner profit remains after every cost.
/// @dev This Base-specific contract is intentionally separate from V3. Existing
///      strategies remain untouched until an explicit migration.
contract HypedArbitrageExecutorV4 {
    uint256 public constant BPS = 10_000;
    uint16 public constant protocolFeeBps = 0;
    uint16 public constant executorProfitShareBps = 1_000;
    uint256 public constant settlementGasOverhead = 120_000;
    uint256 public constant unsignedTxEnvelopeOverhead = 192;
    address public constant baseGasPriceOracle = 0x420000000000000000000000000000000000000F;

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
        uint256 maxFeeReimbursementReserve;
        uint16 minProfitBps;
    }

    struct ExecutionParams {
        uint256 amountInReserve;
        uint256 hAmountForMint;
        uint256 minimumHypedOut;
        uint256 minimumBondOut;
        uint256 minimumReserveOut;
        uint256 feeReimbursementWei;
    }

    error Reentered();
    error ZeroAddress();
    error InvalidConfiguration();
    error UnknownMintClubToken();
    error StrategyAlreadyActive();
    error NotStrategyOwner();
    error UnauthorizedExecutor();
    error UnauthorizedOperatorManager();
    error InvalidPendingExecutor();
    error ContractPaused();
    error StrategyInactive();
    error StrategyExpired();
    error AmountOutsidePermission();
    error AlreadyExecutedThisBlock();
    error MinimumProfitNotMet(uint256 actualProfit, uint256 requiredProfit);
    error FeeLimitExceeded(uint256 actualFee, uint256 maximumFee);
    error FeeClaimExceedsUpperBound(uint256 claimedFee, uint256 maximumFee);
    error FeeOracleUnavailable();
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
        uint16 minProfitBps,
        uint256 maxFeeReimbursementReserve,
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
        uint256 amountSpentReserve,
        uint256 amountReturnedReserve,
        uint256 grossProfitReserve,
        uint256 gasReimbursementReserve,
        uint256 executorIncentiveReserve,
        uint256 ownerProfitReserve,
        uint256 remainingVolume,
        uint64 executionCount
    );
    event TrustedExecutorProposed(address indexed currentExecutor, address indexed pendingExecutor);
    event TrustedExecutorChanged(address indexed previousExecutor, address indexed newExecutor);
    event PauseChanged(bool paused);

    address public immutable weth;
    address public immutable operatorManager;
    IMintClubBond public immutable mintClubBond;
    IUniswapOnchainRouter public immutable onchainRouter;
    address public trustedExecutor;
    address public pendingTrustedExecutor;
    bool public paused;

    uint256 public strategyCount;
    mapping(uint256 strategyId => Strategy strategy) public strategies;
    mapping(address owner => mapping(address hToken => uint256 strategyId)) public activeStrategyId;
    uint256 private locked = 1;

    modifier nonReentrant() {
        if (locked != 1) revert Reentered();
        locked = 2;
        _;
        locked = 1;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(
        address weth_,
        address mintClubBond_,
        address onchainRouter_,
        address trustedExecutor_,
        address operatorManager_
    ) {
        if (
            weth_ == address(0) || mintClubBond_ == address(0) || onchainRouter_ == address(0)
                || trustedExecutor_ == address(0) || operatorManager_ == address(0)
        ) revert ZeroAddress();
        if (trustedExecutor_ == operatorManager_) revert InvalidConfiguration();
        weth = weth_;
        mintClubBond = IMintClubBond(mintClubBond_);
        onchainRouter = IUniswapOnchainRouter(onchainRouter_);
        trustedExecutor = trustedExecutor_;
        operatorManager = operatorManager_;
    }

    receive() external payable { }

    function startStrategy(
        address hToken,
        uint256 maxReservePerExecution,
        uint256 totalVolume,
        uint256 minProfitReserve,
        uint16 minProfitBps,
        uint256 maxFeeReimbursementReserve,
        uint40 validUntil
    ) external whenNotPaused returns (uint256 strategyId) {
        if (
            hToken == address(0) || maxReservePerExecution == 0 || totalVolume == 0
                || maxReservePerExecution > totalVolume || minProfitReserve == 0
                || minProfitBps == 0 || minProfitBps > BPS || maxFeeReimbursementReserve == 0
                || (validUntil != 0 && validUntil <= block.timestamp)
        ) revert InvalidConfiguration();

        (,,,, address reserveToken,) = mintClubBond.tokenBond(hToken);
        if (reserveToken == address(0)) revert UnknownMintClubToken();
        if (reserveToken == hToken || hToken.code.length == 0 || reserveToken.code.length == 0) {
            revert InvalidConfiguration();
        }

        uint256 existingStrategyId = activeStrategyId[msg.sender][hToken];
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
            minProfitReserve: minProfitReserve,
            maxFeeReimbursementReserve: maxFeeReimbursementReserve,
            minProfitBps: minProfitBps
        });
        activeStrategyId[msg.sender][hToken] = strategyId;

        emit StrategyStarted(
            strategyId,
            msg.sender,
            hToken,
            reserveToken,
            maxReservePerExecution,
            totalVolume,
            minProfitReserve,
            minProfitBps,
            maxFeeReimbursementReserve,
            validUntil
        );
    }

    function stopStrategy(uint256 strategyId) external {
        Strategy storage strategy = strategies[strategyId];
        if (strategy.owner != msg.sender) revert NotStrategyOwner();
        if (!strategy.active) revert StrategyInactive();
        _deactivate(strategyId, strategy);
    }

    function proposeTrustedExecutor(address nextExecutor) external {
        if (msg.sender != operatorManager) revert UnauthorizedOperatorManager();
        if (nextExecutor == address(0) || nextExecutor == trustedExecutor) {
            revert InvalidPendingExecutor();
        }
        pendingTrustedExecutor = nextExecutor;
        emit TrustedExecutorProposed(trustedExecutor, nextExecutor);
    }

    function acceptTrustedExecutor() external {
        if (msg.sender != pendingTrustedExecutor) revert InvalidPendingExecutor();
        address previousExecutor = trustedExecutor;
        trustedExecutor = msg.sender;
        delete pendingTrustedExecutor;
        emit TrustedExecutorChanged(previousExecutor, msg.sender);
    }

    function setPaused(bool nextPaused) external {
        if (msg.sender != operatorManager) revert UnauthorizedOperatorManager();
        if (paused == nextPaused) return;
        paused = nextPaused;
        emit PauseChanged(nextPaused);
    }

    function execute(uint256 strategyId, Direction direction, ExecutionParams calldata params)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 ownerReturnReserve)
    {
        uint256 gasStart = gasleft();
        if (msg.sender != trustedExecutor) revert UnauthorizedExecutor();

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

        uint256 amountSpentReserve;
        if (direction == Direction.MintThenSell) {
            amountSpentReserve = _mintThenSell(strategy, params, hBefore);
        } else {
            _buyThenRedeem(strategy, params, hBefore);
            amountSpentReserve = params.amountInReserve;
        }

        uint256 amountReturnedReserve = _balance(strategy.reserveToken) - reserveBefore;
        uint256 grossProfitReserve = amountReturnedReserve > params.amountInReserve
            ? amountReturnedReserve - params.amountInReserve
            : 0;
        uint256 feeUpperBoundWei = _transactionFeeUpperBoundWei(gasStart);
        if (params.feeReimbursementWei > feeUpperBoundWei) {
            revert FeeClaimExceedsUpperBound(params.feeReimbursementWei, feeUpperBoundWei);
        }
        uint256 gasReimbursementReserve =
            _quoteGasCostInReserve(strategy.reserveToken, params.feeReimbursementWei);
        if (gasReimbursementReserve > strategy.maxFeeReimbursementReserve) {
            revert FeeLimitExceeded(gasReimbursementReserve, strategy.maxFeeReimbursementReserve);
        }
        uint256 profitAfterGas = grossProfitReserve > gasReimbursementReserve
            ? grossProfitReserve - gasReimbursementReserve
            : 0;
        uint256 executorIncentiveReserve = profitAfterGas * executorProfitShareBps / BPS;
        uint256 ownerProfitReserve = profitAfterGas - executorIncentiveReserve;
        uint256 percentageProfitFloor = amountSpentReserve * strategy.minProfitBps / BPS;
        uint256 requiredOwnerProfit = strategy.minProfitReserve > percentageProfitFloor
            ? strategy.minProfitReserve
            : percentageProfitFloor;
        if (ownerProfitReserve < requiredOwnerProfit) {
            revert MinimumProfitNotMet(ownerProfitReserve, requiredOwnerProfit);
        }

        uint256 executorReturnReserve = gasReimbursementReserve + executorIncentiveReserve;
        ownerReturnReserve = params.amountInReserve + ownerProfitReserve;
        if (executorReturnReserve > 0) {
            _safeTransfer(strategy.reserveToken, msg.sender, executorReturnReserve);
        }
        _safeTransfer(strategy.reserveToken, strategy.owner, ownerReturnReserve);
        _returnProducedDust(strategy.hToken, strategy.owner, hBefore);
        if (strategy.reserveToken != weth) {
            _returnProducedDust(weth, strategy.owner, wethBefore);
        }

        stored.remainingVolume -= amountSpentReserve;
        stored.executionCount += 1;
        stored.lastExecutionBlock = uint64(block.number);

        emit ArbitrageExecuted(
            strategyId,
            strategy.owner,
            msg.sender,
            direction,
            strategy.reserveToken,
            params.amountInReserve,
            amountSpentReserve,
            amountReturnedReserve,
            grossProfitReserve,
            gasReimbursementReserve,
            executorIncentiveReserve,
            ownerProfitReserve,
            stored.remainingVolume,
            stored.executionCount
        );

        if (stored.remainingVolume == 0) {
            _deactivate(strategyId, stored);
        }
    }

    function quoteGasCostInReserve(address reserveToken, uint256 gasCostWei)
        external
        view
        returns (uint256)
    {
        return _quoteGasCostInReserve(reserveToken, gasCostWei);
    }

    function _mintThenSell(
        Strategy memory strategy,
        ExecutionParams calldata params,
        uint256 hBefore
    ) private returns (uint256 reserveRequired) {
        if (params.hAmountForMint == 0) {
            revert AmountOutsidePermission();
        }
        (reserveRequired,) = mintClubBond.getReserveForToken(strategy.hToken, params.hAmountForMint);
        if (reserveRequired > params.amountInReserve) revert AmountOutsidePermission();

        _approveExact(strategy.reserveToken, address(mintClubBond), reserveRequired);
        mintClubBond.mint(strategy.hToken, params.hAmountForMint, reserveRequired, address(this));
        _approveExact(strategy.reserveToken, address(mintClubBond), 0);

        uint256 hProduced = _balance(strategy.hToken) - hBefore;
        _swap(strategy.hToken, strategy.reserveToken, hProduced, params.minimumReserveOut);
    }

    function _buyThenRedeem(
        Strategy memory strategy,
        ExecutionParams calldata params,
        uint256 hBefore
    ) private {
        uint256 hOut = _swap(
            strategy.reserveToken, strategy.hToken, params.amountInReserve, params.minimumHypedOut
        );
        _approveExact(strategy.hToken, address(mintClubBond), hOut);
        mintClubBond.burn(strategy.hToken, hOut, params.minimumBondOut, address(this));
        _approveExact(strategy.hToken, address(mintClubBond), 0);
        if (_balance(strategy.hToken) < hBefore) revert MissingRoute();
    }

    function _transactionFeeUpperBoundWei(uint256 gasStart) private view returns (uint256) {
        uint256 gasUsed = gasStart - gasleft() + settlementGasOverhead;
        uint256 l2Fee = gasUsed * tx.gasprice;
        if (baseGasPriceOracle.code.length == 0) revert FeeOracleUnavailable();

        (bool l1Success, bytes memory l1Result) = baseGasPriceOracle.staticcall(
            abi.encodeWithSignature(
                "getL1FeeUpperBound(uint256)", msg.data.length + unsignedTxEnvelopeOverhead
            )
        );
        (bool operatorSuccess, bytes memory operatorResult) = baseGasPriceOracle.staticcall(
            abi.encodeWithSignature("getOperatorFee(uint256)", gasUsed)
        );
        if (!l1Success || l1Result.length < 32 || !operatorSuccess || operatorResult.length < 32) {
            revert FeeOracleUnavailable();
        }

        return l2Fee + abi.decode(l1Result, (uint256)) + abi.decode(operatorResult, (uint256));
    }

    function _quoteGasCostInReserve(address reserveToken, uint256 gasCostWei)
        private
        view
        returns (uint256)
    {
        if (gasCostWei == 0) return 0;
        if (reserveToken == weth) return gasCostWei;
        Quote memory quote = onchainRouter.routeExactInput(
            RouterSwapParams({ tokenIn: weth, tokenOut: reserveToken, amountSpecified: gasCostWei })
        );
        if (quote.path.length == 0 || quote.amountOut == 0) revert MissingRoute();
        return quote.amountOut;
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

    function _deactivate(uint256 strategyId, Strategy storage strategy) private {
        strategy.active = false;
        if (activeStrategyId[strategy.owner][strategy.hToken] == strategyId) {
            delete activeStrategyId[strategy.owner][strategy.hToken];
        }
        emit StrategyStopped(strategyId, strategy.owner);
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
