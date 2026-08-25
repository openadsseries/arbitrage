// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { HypedArbitrageExecutorV2 } from "../src/HypedArbitrageExecutorV2.sol";
import { MockERC20, MockRouter, MockBond } from "./HypedArbitrageExecutor.t.sol";

contract V2Keeper {
    function execute(
        HypedArbitrageExecutorV2 executor,
        uint256 strategyId,
        HypedArbitrageExecutorV2.Direction direction,
        HypedArbitrageExecutorV2.ExecutionParams calldata params
    ) external {
        executor.execute(strategyId, direction, params);
    }
}

contract TaxedReserveToken {
    string public name = "Taxed reserve";
    string public symbol = "TAX";
    uint8 public immutable decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

    function _transfer(address sender, address recipient, uint256 amount) private {
        uint256 tax = amount / 100;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount - tax;
        totalSupply -= tax;
    }
}

contract HypedArbitrageExecutorV2Test {
    MockERC20 internal weth;
    MockERC20 internal reserve;
    MockERC20 internal hyped;
    MockRouter internal router;
    MockBond internal bond;
    V2Keeper internal keeper;
    HypedArbitrageExecutorV2 internal executor;

    function setUp() public {
        weth = new MockERC20("Wrapped Ether", "WETH");
        reserve = new MockERC20("Reserve", "OG");
        hyped = new MockERC20("Hyped", "hOG");
        router = new MockRouter();
        bond = new MockBond();
        keeper = new V2Keeper();
        bond.register(address(hyped), address(reserve));
        executor = new HypedArbitrageExecutorV2(address(weth), address(bond), address(router));

        reserve.mint(address(this), 1_000 ether);
        reserve.approve(address(executor), type(uint256).max);
        reserve.mint(address(bond), 10_000 ether);
        bond.seedReserve(address(hyped), 10_000 ether);
    }

    function testMintThenSellSettlesPrincipalAndProfitInReserve() public {
        router.setRate(address(hyped), address(weth), 11, 10);
        router.setRate(address(weth), address(reserve), 12, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV2.Direction.MintThenSell,
            _params(100 ether, 100 ether, 110 ether, 0, 0, 132 ether)
        );

        _assertEq(reserve.balanceOf(address(this)), 1_025.6 ether, "owner reserve return");
        _assertEq(reserve.balanceOf(address(keeper)), 6.4 ether, "keeper reserve reward");
        _assertEq(reserve.balanceOf(address(executor)), 0, "executor reserve retained");
        _assertEq(weth.balanceOf(address(executor)), 0, "executor WETH retained");
        _assertEq(hyped.balanceOf(address(executor)), 0, "executor h-token retained");
        _assertEq(reserve.allowance(address(executor), address(bond)), 0, "bond reserve allowance");
        _assertEq(
            hyped.allowance(address(executor), address(router)), 0, "router h-token allowance"
        );
        _assertInactive(strategyId);
    }

    function testBuyThenRedeemSettlesPrincipalAndProfitInReserve() public {
        router.setRate(address(reserve), address(weth), 12, 10);
        router.setRate(address(weth), address(hyped), 11, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV2.Direction.BuyThenRedeem,
            _params(100 ether, 0, 120 ether, 132 ether, 132 ether, 132 ether)
        );

        _assertEq(reserve.balanceOf(address(this)), 1_025.6 ether, "owner reserve return");
        _assertEq(reserve.balanceOf(address(keeper)), 6.4 ether, "keeper reserve reward");
        _assertEq(reserve.balanceOf(address(executor)), 0, "executor reserve retained");
        _assertEq(weth.balanceOf(address(executor)), 0, "executor WETH retained");
        _assertEq(hyped.balanceOf(address(executor)), 0, "executor h-token retained");
        _assertEq(hyped.allowance(address(executor), address(bond)), 0, "bond h-token allowance");
        _assertInactive(strategyId);
    }

    function testUnprofitableExecutionRevertsAtomically() public {
        router.setRate(address(hyped), address(weth), 1, 2);
        router.setRate(address(weth), address(reserve), 1, 1);
        uint256 strategyId = _start(100 ether, 1 ether);
        uint256 ownerBefore = reserve.balanceOf(address(this));
        uint256 allowanceBefore = reserve.allowance(address(this), address(executor));

        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV2.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutorV2.Direction.MintThenSell,
                        _params(100 ether, 100 ether, 50 ether, 0, 0, 50 ether)
                    )
                )
            );

        require(!success, "loss should revert");
        _assertEq(reserve.balanceOf(address(this)), ownerBefore, "owner balance changed");
        _assertEq(
            reserve.allowance(address(this), address(executor)),
            allowanceBefore,
            "owner allowance changed"
        );
        (,,,, bool active,,) = executor.strategies(strategyId);
        require(active, "failed execution closed permission");
    }

    function testDonatedReserveCannotBeCountedAsProfit() public {
        reserve.mint(address(executor), 7 ether);
        router.setRate(address(hyped), address(weth), 11, 10);
        router.setRate(address(weth), address(reserve), 12, 10);
        uint256 strategyId = _start(100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV2.Direction.MintThenSell,
            _params(100 ether, 100 ether, 110 ether, 0, 0, 132 ether)
        );

        _assertEq(reserve.balanceOf(address(this)), 1_025.6 ether, "donation leaked to owner");
        _assertEq(reserve.balanceOf(address(keeper)), 6.4 ether, "donation changed reward");
        _assertEq(reserve.balanceOf(address(executor)), 7 ether, "donation was moved");
    }

    function testRejectsFeeOnTransferReserveBeforeAnyRouteRuns() public {
        TaxedReserveToken taxed = new TaxedReserveToken();
        MockERC20 taxedHyped = new MockERC20("Taxed Hyped", "hTAX");
        MockBond taxedBond = new MockBond();
        MockRouter taxedRouter = new MockRouter();
        taxedBond.register(address(taxedHyped), address(taxed));
        HypedArbitrageExecutorV2 taxedExecutor =
            new HypedArbitrageExecutorV2(address(weth), address(taxedBond), address(taxedRouter));
        taxed.mint(address(this), 100 ether);
        taxed.approve(address(taxedExecutor), type(uint256).max);
        uint256 strategyId = taxedExecutor.startStrategy(
            address(taxedHyped), 100 ether, 1, uint40(block.timestamp + 1 days)
        );

        (bool success,) = address(taxedExecutor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV2.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutorV2.Direction.MintThenSell,
                        _params(100 ether, 100 ether, 0, 0, 0, 0)
                    )
                )
            );

        require(!success, "fee-on-transfer reserve accepted");
        _assertEq(taxed.balanceOf(address(this)), 100 ether, "tax persisted after revert");
        _assertEq(taxed.balanceOf(address(taxedExecutor)), 0, "executor retained taxed token");
    }

    function testOnlyOneActivePermissionPerWalletAndReserve() public {
        MockERC20 secondHyped = new MockERC20("Second hyped", "hOG2");
        bond.register(address(secondHyped), address(reserve));
        _start(100 ether, 1 ether);

        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV2.startStrategy,
                    (address(secondHyped), 100 ether, 1 ether, uint40(block.timestamp + 1 days))
                )
            );

        require(!success, "duplicate reserve permission accepted");
    }

    function testReserveChangeInvalidatesPermission() public {
        MockERC20 otherReserve = new MockERC20("Other reserve", "OTHER");
        uint256 strategyId = _start(100 ether, 1 ether);
        bond.setReserve(address(hyped), address(otherReserve));

        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV2.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutorV2.Direction.MintThenSell,
                        _params(100 ether, 100 ether, 0, 0, 0, 0)
                    )
                )
            );

        require(!success, "changed reserve accepted");
        _assertEq(reserve.balanceOf(address(this)), 1_000 ether, "owner capital moved");
    }

    function testStopClearsActivePermission() public {
        uint256 strategyId = _start(100 ether, 1 ether);
        executor.stopStrategy(strategyId);
        _assertInactive(strategyId);
        _assertEq(
            executor.activeStrategyId(address(this), address(reserve)), 0, "active id retained"
        );
    }

    function testFeePolicyIsImmutable() public view {
        _assertEq(executor.protocolFeeBps(), 0, "protocol fee");
        _assertEq(executor.executorRewardBps(), 2_000, "keeper reward");
    }

    function _start(uint256 maxReserve, uint256 minProfit) private returns (uint256) {
        return executor.startStrategy(
            address(hyped), maxReserve, minProfit, uint40(block.timestamp + 1 days)
        );
    }

    function _params(
        uint256 amountInReserve,
        uint256 hAmountForMint,
        uint256 minimumWethOut,
        uint256 minimumHypedOut,
        uint256 minimumBondOut,
        uint256 minimumReserveOut
    ) private pure returns (HypedArbitrageExecutorV2.ExecutionParams memory params) {
        params = HypedArbitrageExecutorV2.ExecutionParams({
            amountInReserve: amountInReserve,
            hAmountForMint: hAmountForMint,
            minimumWethOut: minimumWethOut,
            minimumHypedOut: minimumHypedOut,
            minimumBondOut: minimumBondOut,
            minimumReserveOut: minimumReserveOut
        });
    }

    function _assertInactive(uint256 strategyId) private view {
        (,,,, bool active,,) = executor.strategies(strategyId);
        require(!active, "strategy is active");
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }
}
