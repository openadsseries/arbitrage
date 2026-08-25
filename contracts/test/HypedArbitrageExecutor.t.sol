// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    HypedArbitrageExecutor,
    RouterSwapParams,
    Quote,
    Pool,
    PoolKey
} from "../src/HypedArbitrageExecutor.sol";

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 permitted = allowance[sender][msg.sender];
        require(permitted >= amount, "allowance");
        allowance[sender][msg.sender] = permitted - amount;
        _transfer(sender, recipient, amount);
        return true;
    }

    function burnFrom(address sender, uint256 amount) external {
        uint256 permitted = allowance[sender][msg.sender];
        require(permitted >= amount, "allowance");
        allowance[sender][msg.sender] = permitted - amount;
        balanceOf[sender] -= amount;
        totalSupply -= amount;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
    }
}

contract MockRouter {
    struct Rate {
        uint256 numerator;
        uint256 denominator;
    }

    mapping(bytes32 => Rate) internal rates;

    function setRate(address tokenIn, address tokenOut, uint256 numerator, uint256 denominator)
        external
    {
        rates[keccak256(abi.encode(tokenIn, tokenOut))] = Rate(numerator, denominator);
    }

    function routeExactInput(RouterSwapParams memory params)
        public
        view
        returns (Quote memory quote)
    {
        Rate memory rate = rates[keccak256(abi.encode(params.tokenIn, params.tokenOut))];
        if (rate.denominator == 0) return quote;
        quote.path = _path(params.tokenIn, params.tokenOut);
        quote.amountIn = params.amountSpecified;
        quote.amountOut = params.amountSpecified * rate.numerator / rate.denominator;
    }

    function routeExactOutput(RouterSwapParams memory params)
        public
        view
        returns (Quote memory quote)
    {
        Rate memory rate = rates[keccak256(abi.encode(params.tokenIn, params.tokenOut))];
        if (rate.numerator == 0) return quote;
        quote.path = _path(params.tokenIn, params.tokenOut);
        quote.amountIn =
            (params.amountSpecified * rate.denominator + rate.numerator - 1) / rate.numerator;
        quote.amountOut = params.amountSpecified;
    }

    function swapExactInput(Quote memory quote, address recipient, uint256, bool)
        external
        returns (uint256 amountOut)
    {
        Pool memory pool = quote.path[0];
        MockERC20(pool.tokenIn).transferFrom(msg.sender, address(this), quote.amountIn);
        amountOut = quote.amountOut;
        MockERC20(pool.tokenOut).mint(recipient, amountOut);
    }

    function swapExactOutput(Quote memory quote, address recipient, uint256, bool)
        external
        returns (uint256 amountIn)
    {
        Pool memory pool = quote.path[0];
        amountIn = quote.amountIn;
        MockERC20(pool.tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(pool.tokenOut).mint(recipient, quote.amountOut);
    }

    function _path(address tokenIn, address tokenOut) private pure returns (Pool[] memory path) {
        path = new Pool[](1);
        path[0] = Pool({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: 0,
            pool: address(1),
            version: 2,
            key: PoolKey(address(0), address(0), 0, 0, address(0))
        });
    }
}

contract MockBond {
    struct Bond {
        address creator;
        uint16 mintRoyalty;
        uint16 burnRoyalty;
        uint40 createdAt;
        address reserveToken;
        uint256 reserveBalance;
    }

    mapping(address => Bond) internal bonds;

    function register(address token, address reserveToken) external {
        bonds[token] = Bond(msg.sender, 0, 0, uint40(block.timestamp), reserveToken, 0);
    }

    function seedReserve(address token, uint256 amount) external {
        bonds[token].reserveBalance += amount;
    }

    function setReserve(address token, address reserveToken) external {
        bonds[token].reserveToken = reserveToken;
    }

    function tokenBond(address token)
        external
        view
        returns (address, uint16, uint16, uint40, address, uint256)
    {
        Bond memory bond = bonds[token];
        return (
            bond.creator,
            bond.mintRoyalty,
            bond.burnRoyalty,
            bond.createdAt,
            bond.reserveToken,
            bond.reserveBalance
        );
    }

    function mint(address token, uint256 tokensToMint, uint256 maxReserveAmount, address receiver)
        external
        returns (uint256 reserveAmount)
    {
        Bond storage bond = bonds[token];
        reserveAmount = tokensToMint;
        require(reserveAmount <= maxReserveAmount, "max reserve");
        MockERC20(bond.reserveToken).transferFrom(msg.sender, address(this), reserveAmount);
        bond.reserveBalance += reserveAmount;
        MockERC20(token).mint(receiver, tokensToMint);
    }

    function getReserveForToken(address, uint256 tokensToMint)
        external
        pure
        returns (uint256 reserveAmount, uint256 royalty)
    {
        return (tokensToMint, 0);
    }

    function burn(address token, uint256 tokensToBurn, uint256 minRefund, address receiver)
        external
        returns (uint256 refundAmount)
    {
        Bond storage bond = bonds[token];
        refundAmount = tokensToBurn;
        require(refundAmount >= minRefund, "min refund");
        MockERC20(token).burnFrom(msg.sender, tokensToBurn);
        bond.reserveBalance -= refundAmount;
        MockERC20(bond.reserveToken).transfer(receiver, refundAmount);
    }
}

contract Caller {
    function execute(
        HypedArbitrageExecutor executor,
        uint256 strategyId,
        HypedArbitrageExecutor.Direction direction,
        uint256 amountIn,
        uint256 hAmount,
        uint256 minFirst,
        uint256 minBond,
        uint256 minFinal
    ) external {
        executor.execute(strategyId, direction, amountIn, hAmount, minFirst, minBond, minFinal);
    }

    function tryStop(HypedArbitrageExecutor executor, uint256 strategyId) external returns (bool) {
        (bool success,) = address(executor)
            .call(abi.encodeCall(HypedArbitrageExecutor.stopStrategy, (strategyId)));
        return success;
    }
}

contract HypedArbitrageExecutorTest {
    MockERC20 internal weth;
    MockERC20 internal og;
    MockERC20 internal hyped;
    MockRouter internal router;
    MockBond internal bond;
    Caller internal keeper;
    Caller internal feeRecipient;
    HypedArbitrageExecutor internal executor;

    function setUp() public {
        weth = new MockERC20("Wrapped Ether", "WETH");
        og = new MockERC20("Original", "OG");
        hyped = new MockERC20("Hyped", "hOG");
        router = new MockRouter();
        bond = new MockBond();
        keeper = new Caller();
        feeRecipient = new Caller();
        bond.register(address(hyped), address(og));
        router.setRate(address(weth), address(og), 1, 1);
        router.setRate(address(weth), address(hyped), 1, 1);
        executor =
            new HypedArbitrageExecutor(address(weth), address(bond), address(router), 100 ether);
        weth.mint(address(this), 1_000 ether);
        weth.approve(address(executor), 1_000 ether);
        og.mint(address(bond), 10_000 ether);
        bond.seedReserve(address(hyped), 10_000 ether);
    }

    function testMintThenSellReturnsCapitalAndRealizedProfit() public {
        router.setRate(address(weth), address(og), 12, 10);
        router.setRate(address(hyped), address(weth), 11, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutor.Direction.MintThenSell,
            100 ether,
            120 ether,
            120 ether,
            0,
            132 ether
        );

        _assertEq(weth.balanceOf(address(this)), 1_025.6 ether, "owner return");
        _assertEq(weth.balanceOf(address(keeper)), 6.4 ether, "keeper reward");
        _assertEq(weth.balanceOf(address(feeRecipient)), 0, "protocol fee");
        _assertEq(weth.balanceOf(address(executor)), 0, "executor WETH retained");
        _assertEq(og.balanceOf(address(executor)), 0, "executor OG retained");
        _assertEq(hyped.balanceOf(address(executor)), 0, "executor h-token retained");
        _assertEq(weth.allowance(address(executor), address(router)), 0, "router WETH allowance");
        _assertEq(og.allowance(address(executor), address(bond)), 0, "exchange OG allowance");
        _assertEq(hyped.allowance(address(executor), address(router)), 0, "router h allowance");
    }

    function testBuyThenRedeemReturnsCapitalAndRealizedProfit() public {
        router.setRate(address(weth), address(hyped), 12, 10);
        router.setRate(address(og), address(weth), 11, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutor.Direction.BuyThenRedeem,
            100 ether,
            0,
            120 ether,
            120 ether,
            132 ether
        );

        _assertEq(weth.balanceOf(address(this)), 1_025.6 ether, "owner return");
        _assertEq(weth.balanceOf(address(keeper)), 6.4 ether, "keeper reward");
        _assertEq(weth.balanceOf(address(feeRecipient)), 0, "protocol fee");
        _assertEq(weth.balanceOf(address(executor)), 0, "executor WETH retained");
        _assertEq(hyped.allowance(address(executor), address(bond)), 0, "exchange h allowance");
        _assertEq(og.allowance(address(executor), address(router)), 0, "router OG allowance");
    }

    function testSuccessfulExecutionEndsStrategy() public {
        router.setRate(address(weth), address(og), 12, 10);
        router.setRate(address(hyped), address(weth), 11, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutor.Direction.MintThenSell,
            100 ether,
            120 ether,
            120 ether,
            0,
            132 ether
        );

        (,,,, bool active,,) = executor.strategies(strategyId);
        require(!active, "successful strategy remained active");
        _assertEq(executor.activeStrategyId(address(this), address(hyped)), 0, "active strategy id");
    }

    function testUnusedInputIsReturnedWithProfit() public {
        router.setRate(address(weth), address(og), 2, 1);
        router.setRate(address(hyped), address(weth), 11, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutor.Direction.MintThenSell,
            100 ether,
            100 ether,
            0,
            0,
            110 ether
        );

        _assertEq(weth.balanceOf(address(this)), 1_048 ether, "unused input not returned");
        _assertEq(weth.balanceOf(address(keeper)), 12 ether, "keeper reward");
        _assertEq(weth.balanceOf(address(executor)), 0, "executor retained WETH");
    }

    function testDonatedBalanceCannotBeCountedAsUserProfit() public {
        weth.mint(address(executor), 7 ether);
        router.setRate(address(weth), address(og), 12, 10);
        router.setRate(address(hyped), address(weth), 11, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutor.Direction.MintThenSell,
            100 ether,
            120 ether,
            0,
            0,
            132 ether
        );

        _assertEq(weth.balanceOf(address(this)), 1_025.6 ether, "donation leaked to owner");
        _assertEq(weth.balanceOf(address(keeper)), 6.4 ether, "donation changed reward");
        _assertEq(weth.balanceOf(address(executor)), 7 ether, "donation was moved");
    }

    function testFeePolicyIsImmutableInBytecode() public view {
        _assertEq(executor.protocolFeeBps(), 0, "protocol fee");
        _assertEq(executor.executorRewardBps(), 2_000, "keeper reward");
    }

    function testUnprofitableExecutionRevertsEveryTransfer() public {
        router.setRate(address(weth), address(og), 1, 1);
        router.setRate(address(hyped), address(weth), 1, 2);
        uint256 strategyId = _start(100 ether, 1 ether);
        uint256 balanceBefore = weth.balanceOf(address(this));
        uint256 allowanceBefore = weth.allowance(address(this), address(executor));

        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutor.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutor.Direction.MintThenSell,
                        100 ether,
                        100 ether,
                        100 ether,
                        0,
                        0
                    )
                )
            );

        require(!success, "loss should revert");
        _assertEq(weth.balanceOf(address(this)), balanceBefore, "owner balance changed");
        _assertEq(
            weth.allowance(address(this), address(executor)), allowanceBefore, "allowance changed"
        );
    }

    function testStopBlocksFutureExecution() public {
        uint256 strategyId = _start(100 ether, 1 ether);
        executor.stopStrategy(strategyId);

        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutor.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutor.Direction.MintThenSell,
                        100 ether,
                        100 ether,
                        0,
                        0,
                        0
                    )
                )
            );
        require(!success, "stopped strategy executed");
    }

    function testChangedReserveCannotUseOldPermission() public {
        uint256 strategyId = _start(100 ether, 1 ether);
        MockERC20 replacement = new MockERC20("Replacement", "NEW");
        bond.setReserve(address(hyped), address(replacement));
        uint256 balanceBefore = weth.balanceOf(address(this));

        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutor.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutor.Direction.MintThenSell,
                        100 ether,
                        100 ether,
                        0,
                        0,
                        0
                    )
                )
            );

        require(!success, "changed reserve used stale strategy");
        _assertEq(weth.balanceOf(address(this)), balanceBefore, "owner balance changed");
    }

    function testOnlyOwnerCanStop() public {
        uint256 strategyId = _start(100 ether, 1 ether);
        require(!keeper.tryStop(executor, strategyId), "non-owner stopped strategy");
        (,,,, bool active,,) = executor.strategies(strategyId);
        require(active, "strategy changed");
    }

    function testDuplicateActiveStrategyCannotStart() public {
        _start(100 ether, 1 ether);
        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutor.startStrategy,
                    (address(hyped), 50 ether, 1 ether, uint40(block.timestamp + 1 days))
                )
            );
        require(!success, "duplicate active strategy started");
    }

    function testStoppedStrategyCanBeReplaced() public {
        uint256 first = _start(100 ether, 1 ether);
        executor.stopStrategy(first);
        uint256 second = _start(50 ether, 1 ether);
        _assertEq(
            executor.activeStrategyId(address(this), address(hyped)), second, "active strategy id"
        );
    }

    function testMissingPoolCannotStart() public {
        MockERC20 another = new MockERC20("Another", "hNO");
        bond.register(address(another), address(og));
        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutor.startStrategy,
                    (address(another), 100 ether, 1 ether, uint40(block.timestamp + 1 days))
                )
            );
        require(!success, "strategy without h pool started");
    }

    function testGlobalExecutionLimitCannotBeExceeded() public {
        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutor.startStrategy,
                    (address(hyped), 100 ether + 1, 1 ether, uint40(block.timestamp + 1 days))
                )
            );
        require(!success, "strategy exceeded the global execution limit");
    }

    function _start(uint256 maxInput, uint256 minProfit) private returns (uint256) {
        return executor.startStrategy(
            address(hyped), maxInput, minProfit, uint40(block.timestamp + 1 days)
        );
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }
}
