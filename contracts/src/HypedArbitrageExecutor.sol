// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface IWETHMinimal {
    function deposit() external payable;
}

interface IMintClubBond {
    function tokenBond(address token)
        external
        view
        returns (
            address creator,
            uint16 mintRoyalty,
            uint16 burnRoyalty,
            uint40 createdAt,
            address reserveToken,
            uint256 reserveBalance
        );

    function mint(address token, uint256 tokensToMint, uint256 maxReserveAmount, address receiver)
        external
        returns (uint256 reserveAmount);

    function getReserveForToken(address token, uint256 tokensToMint)
        external
        view
        returns (uint256 reserveAmount, uint256 royalty);

    function burn(address token, uint256 tokensToBurn, uint256 minRefund, address receiver)
        external
        returns (uint256 refundAmount);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct Pool {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address pool;
    uint8 version;
    PoolKey key;
}

struct Quote {
    Pool[] path;
    uint256 amountIn;
    uint256 amountOut;
}

struct RouterSwapParams {
    address tokenIn;
    address tokenOut;
    uint256 amountSpecified;
}

interface IUniswapOnchainRouter {
    function routeExactInput(RouterSwapParams memory params)
        external
        view
        returns (Quote memory quote);

    function routeExactOutput(RouterSwapParams memory params)
        external
        view
        returns (Quote memory quote);

    function swapExactInput(
        Quote memory quote,
        address recipient,
        uint256 deadline,
        bool unwrapOutput
    ) external payable returns (uint256 amountOut);

    function swapExactOutput(
        Quote memory quote,
        address recipient,
        uint256 deadline,
        bool unwrapOutput
    ) external payable returns (uint256 amountIn);
}

/// @notice Executes only the two fixed GETHYPED arbitrage paths. It never holds user capital
///         between executions and has no owner, upgrade hook, or withdrawal function.
contract HypedArbitrageExecutor {
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
        uint256 maxWethPerExecution;
        uint256 minProfit;
    }

    error Reentered();
    error ZeroAddress();
    error InvalidConfiguration();
    error UnknownMintClubToken();
    error MissingPool();
    error StrategyAlreadyActive();
    error NotStrategyOwner();
    error StrategyInactive();
    error StrategyExpired();
    error AmountOutsidePermission();
    error MinimumProfitNotMet(uint256 actualProfit, uint256 requiredProfit);
    error TokenCallFailed(address token);

    event StrategyStarted(
        uint256 indexed strategyId,
        address indexed owner,
        address indexed hToken,
        address reserveToken,
        uint256 maxWethPerExecution,
        uint256 minProfit,
        uint40 validUntil
    );
    event StrategyStopped(uint256 indexed strategyId, address indexed owner);
    event ArbitrageExecuted(
        uint256 indexed strategyId,
        address indexed owner,
        address indexed executor,
        Direction direction,
        uint256 amountIn,
        uint256 amountReturned,
        uint256 grossProfit,
        uint256 protocolFee,
        uint256 executorReward,
        uint256 ownerProfit
    );

    address public immutable weth;
    IMintClubBond public immutable mintClubBond;
    IUniswapOnchainRouter public immutable onchainRouter;
    uint256 public immutable globalMaxWethPerExecution;

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

    constructor(
        address weth_,
        address mintClubBond_,
        address onchainRouter_,
        uint256 globalMaxWethPerExecution_
    ) {
        if (weth_ == address(0) || mintClubBond_ == address(0) || onchainRouter_ == address(0)) {
            revert ZeroAddress();
        }
        if (globalMaxWethPerExecution_ == 0) revert InvalidConfiguration();

        weth = weth_;
        mintClubBond = IMintClubBond(mintClubBond_);
        onchainRouter = IUniswapOnchainRouter(onchainRouter_);
        globalMaxWethPerExecution = globalMaxWethPerExecution_;
    }

    /// @dev Uniswap V4 pools may settle their WETH-facing side as native ETH.
    ///      The swap helpers wrap only the ETH received by the current call back into WETH.
    receive() external payable { }

    /// @notice Starts an expiring, per-execution WETH permission for one verified h-token.
    /// @dev The ERC-20 allowance is separate. The UI limits it and revokes it when stopping.
    function startStrategy(
        address hToken,
        uint256 maxWethPerExecution,
        uint256 minProfit,
        uint40 validUntil
    ) external returns (uint256 strategyId) {
        if (
            hToken == address(0) || maxWethPerExecution == 0 || minProfit == 0
                || validUntil <= block.timestamp || maxWethPerExecution > globalMaxWethPerExecution
        ) revert InvalidConfiguration();

        (,,,, address reserveToken,) = mintClubBond.tokenBond(hToken);
        if (reserveToken == address(0)) revert UnknownMintClubToken();
        if (reserveToken == weth || reserveToken == hToken || hToken == weth) {
            revert InvalidConfiguration();
        }
        _requireMarket(reserveToken);
        _requireMarket(hToken);
        uint256 existingStrategyId = activeStrategyId[msg.sender][hToken];
        if (existingStrategyId != 0) {
            Strategy memory existing = strategies[existingStrategyId];
            if (existing.active && block.timestamp <= existing.validUntil) {
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
            maxWethPerExecution: maxWethPerExecution,
            minProfit: minProfit
        });
        activeStrategyId[msg.sender][hToken] = strategyId;

        emit StrategyStarted(
            strategyId, msg.sender, hToken, reserveToken, maxWethPerExecution, minProfit, validUntil
        );
    }

    function stopStrategy(uint256 strategyId) external {
        Strategy storage strategy = strategies[strategyId];
        if (strategy.owner != msg.sender) revert NotStrategyOwner();
        strategy.active = false;
        if (activeStrategyId[msg.sender][strategy.hToken] == strategyId) {
            delete activeStrategyId[msg.sender][strategy.hToken];
        }
        emit StrategyStopped(strategyId, msg.sender);
    }

    /// @notice Executes atomically. If the configured minimum profit is not reached, every
    ///         swap, mint/burn, and WETH transfer is reverted.
    /// @param hAmountForMint Exact h-token output for MintThenSell; ignored for BuyThenRedeem.
    function execute(
        uint256 strategyId,
        Direction direction,
        uint256 amountIn,
        uint256 hAmountForMint,
        uint256 minimumFirstSwapOut,
        uint256 minimumBondOut,
        uint256 minimumFinalSwapOut
    ) external nonReentrant returns (uint256 ownerReturn) {
        Strategy memory strategy = strategies[strategyId];
        if (!strategy.active || strategy.owner == address(0)) revert StrategyInactive();
        if (block.timestamp > strategy.validUntil) revert StrategyExpired();
        if (amountIn == 0 || amountIn > strategy.maxWethPerExecution) {
            revert AmountOutsidePermission();
        }
        (,,,, address currentReserveToken,) = mintClubBond.tokenBond(strategy.hToken);
        if (currentReserveToken != strategy.reserveToken) revert InvalidConfiguration();

        uint256 wethBefore = _balance(weth);
        uint256 reserveBefore = _balance(strategy.reserveToken);
        uint256 hBefore = _balance(strategy.hToken);
        _safeTransferFrom(weth, strategy.owner, address(this), amountIn);

        if (direction == Direction.MintThenSell) {
            if (hAmountForMint == 0) revert AmountOutsidePermission();
            (uint256 reserveRequired,) =
                mintClubBond.getReserveForToken(strategy.hToken, hAmountForMint);
            _swapExactOutput(weth, strategy.reserveToken, reserveRequired, amountIn);
            _approveExact(strategy.reserveToken, address(mintClubBond), reserveRequired);
            mintClubBond.mint(strategy.hToken, hAmountForMint, reserveRequired, address(this));
            _approveExact(strategy.reserveToken, address(mintClubBond), 0);
            uint256 hProduced = _balance(strategy.hToken) - hBefore;
            _swap(strategy.hToken, weth, hProduced, minimumFinalSwapOut);
        } else {
            uint256 hReceived = _swap(weth, strategy.hToken, amountIn, minimumFirstSwapOut);
            _approveExact(strategy.hToken, address(mintClubBond), hReceived);
            mintClubBond.burn(strategy.hToken, hReceived, minimumBondOut, address(this));
            _approveExact(strategy.hToken, address(mintClubBond), 0);
            uint256 reserveProduced = _balance(strategy.reserveToken) - reserveBefore;
            _swap(strategy.reserveToken, weth, reserveProduced, minimumFinalSwapOut);
        }

        uint256 amountReturned = _balance(weth) - wethBefore;
        uint256 grossProfit = amountReturned > amountIn ? amountReturned - amountIn : 0;
        uint256 protocolFee = 0;
        uint256 executorReward = grossProfit * executorRewardBps / BPS;
        uint256 ownerProfit = grossProfit - protocolFee - executorReward;
        if (ownerProfit < strategy.minProfit) {
            revert MinimumProfitNotMet(ownerProfit, strategy.minProfit);
        }
        ownerReturn = amountIn + ownerProfit;

        if (executorReward > 0) _safeTransfer(weth, msg.sender, executorReward);
        _safeTransfer(weth, strategy.owner, ownerReturn);

        _returnProducedDust(strategy.reserveToken, strategy.owner, reserveBefore);
        _returnProducedDust(strategy.hToken, strategy.owner, hBefore);

        // The UI grants exactly one execution amount. End the strategy after a successful
        // route so the onchain state never remains "active" after its allowance is consumed.
        strategies[strategyId].active = false;
        if (activeStrategyId[strategy.owner][strategy.hToken] == strategyId) {
            delete activeStrategyId[strategy.owner][strategy.hToken];
        }

        emit ArbitrageExecuted(
            strategyId,
            strategy.owner,
            msg.sender,
            direction,
            amountIn,
            amountReturned,
            grossProfit,
            protocolFee,
            executorReward,
            ownerProfit
        );
        emit StrategyStopped(strategyId, strategy.owner);
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimumOut)
        private
        returns (uint256 amountOut)
    {
        uint256 nativeBefore = address(this).balance;
        Quote memory quote = onchainRouter.routeExactInput(
            RouterSwapParams({ tokenIn: tokenIn, tokenOut: tokenOut, amountSpecified: amountIn })
        );
        if (quote.path.length == 0 || quote.amountOut < minimumOut) revert MissingPool();
        // The router's V4 quoter can slightly overstate output for pools with protocol fees.
        // Use the caller's protected minimum for execution, then verify the actual return below.
        quote.amountOut = minimumOut;
        _approveExact(tokenIn, address(onchainRouter), amountIn);
        amountOut = onchainRouter.swapExactInput(quote, address(this), block.timestamp, false);
        _approveExact(tokenIn, address(onchainRouter), 0);
        _wrapNativeReceived(nativeBefore);
        if (amountOut < minimumOut) revert MissingPool();
    }

    function _swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maximumIn
    ) private returns (uint256 amountIn) {
        Quote memory quote = onchainRouter.routeExactOutput(
            RouterSwapParams({ tokenIn: tokenIn, tokenOut: tokenOut, amountSpecified: amountOut })
        );
        if (quote.path.length == 0 || quote.amountIn > maximumIn) revert MissingPool();
        _approveExact(tokenIn, address(onchainRouter), quote.amountIn);
        amountIn = onchainRouter.swapExactOutput(quote, address(this), block.timestamp, false);
        _approveExact(tokenIn, address(onchainRouter), 0);
    }

    function _requireMarket(address token) private view {
        Quote memory quote = onchainRouter.routeExactInput(
            RouterSwapParams({ tokenIn: weth, tokenOut: token, amountSpecified: 1e12 })
        );
        if (quote.path.length == 0 || quote.amountOut == 0) revert MissingPool();
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
        (bool success, bytes memory result) = token.call(data);
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenCallFailed(token);
        }
    }
}
