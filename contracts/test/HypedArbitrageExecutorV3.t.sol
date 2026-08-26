// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { HypedArbitrageExecutorV3 } from "../src/HypedArbitrageExecutorV3.sol";
import { MockERC20, MockRouter, MockBond } from "./HypedArbitrageExecutor.t.sol";

interface VmV3 {
    function roll(uint256 newHeight) external;
    function warp(uint256 newTimestamp) external;
}

contract V3Keeper {
    function execute(
        HypedArbitrageExecutorV3 executor,
        uint256 strategyId,
        HypedArbitrageExecutorV3.Direction direction,
        HypedArbitrageExecutorV3.ExecutionParams calldata params
    ) external {
        executor.execute(strategyId, direction, params);
    }

    function tryStop(HypedArbitrageExecutorV3 executor, uint256 strategyId)
        external
        returns (bool)
    {
        (bool success,) = address(executor)
            .call(abi.encodeCall(HypedArbitrageExecutorV3.stopStrategy, (strategyId)));
        return success;
    }
}

contract HypedArbitrageExecutorV3Test {
    VmV3 internal constant vm = VmV3(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 internal weth;
    MockERC20 internal reserve;
    MockERC20 internal hyped;
    MockRouter internal router;
    MockBond internal bond;
    V3Keeper internal keeper;
    HypedArbitrageExecutorV3 internal executor;

    function setUp() public {
        weth = new MockERC20("Wrapped Ether", "WETH");
        reserve = new MockERC20("Reserve", "OG");
        hyped = new MockERC20("Hyped", "hOG");
        router = new MockRouter();
        bond = new MockBond();
        keeper = new V3Keeper();
        bond.register(address(hyped), address(reserve));
        executor = new HypedArbitrageExecutorV3(address(weth), address(bond), address(router));

        reserve.mint(address(this), 1_000 ether);
        reserve.mint(address(bond), 10_000 ether);
        bond.seedReserve(address(hyped), 10_000 ether);
    }

    function testRunsRepeatedlyUntilCumulativeLimitIsConsumed() public {
        _setProfitableMintRoute();
        reserve.approve(address(executor), 250 ether);
        uint256 strategyId = _start(100 ether, 250 ether, 1 ether, 0);
        uint256 nextBlock = block.number + 1;

        _executeMint(strategyId, 100 ether, 100 ether, 110 ether, 132 ether);
        _assertStrategy(strategyId, true, 1, 150 ether);

        vm.roll(nextBlock++);
        _executeMint(strategyId, 100 ether, 100 ether, 110 ether, 132 ether);
        _assertStrategy(strategyId, true, 2, 50 ether);

        vm.roll(nextBlock);
        _executeMint(strategyId, 50 ether, 50 ether, 55 ether, 66 ether);
        _assertStrategy(strategyId, false, 3, 0);

        _assertEq(reserve.balanceOf(address(this)), 1_064 ether, "owner cumulative profit");
        _assertEq(reserve.balanceOf(address(keeper)), 16 ether, "keeper cumulative reward");
        _assertEq(
            reserve.allowance(address(this), address(executor)), 0, "bounded allowance remains"
        );
        _assertEq(
            executor.activeStrategyId(address(this), address(reserve)), 0, "active id retained"
        );
    }

    function testBuyThenRedeemSettlesPrincipalAndProfitInReserve() public {
        router.setRate(address(reserve), address(weth), 12, 10);
        router.setRate(address(weth), address(hyped), 11, 10);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(100 ether, 100 ether, 1 ether, 0);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV3.Direction.BuyThenRedeem,
            _params(100 ether, 0, 120 ether, 132 ether, 132 ether, 132 ether)
        );

        _assertEq(reserve.balanceOf(address(this)), 1_025.6 ether, "owner reserve return");
        _assertEq(reserve.balanceOf(address(keeper)), 6.4 ether, "keeper reserve reward");
        _assertEq(reserve.balanceOf(address(executor)), 0, "executor reserve retained");
        _assertEq(weth.balanceOf(address(executor)), 0, "executor WETH retained");
        _assertEq(hyped.balanceOf(address(executor)), 0, "executor h-token retained");
        _assertEq(hyped.allowance(address(executor), address(bond)), 0, "bond h-token allowance");
        _assertStrategy(strategyId, false, 1, 0);
    }

    function testNoExpiryRemainsActiveUntilOwnerStops() public {
        _setProfitableMintRoute();
        reserve.approve(address(executor), 300 ether);
        uint256 strategyId = _start(100 ether, 300 ether, 1 ether, 0);

        _executeMint(strategyId, 100 ether, 100 ether, 110 ether, 132 ether);
        _assertStrategy(strategyId, true, 1, 200 ether);

        executor.stopStrategy(strategyId);
        _assertStrategy(strategyId, false, 1, 200 ether);
        require(!keeper.tryStop(executor, strategyId), "non-owner or duplicate stop accepted");
    }

    function testOptionalExpiryRejectsExecutionWithoutMovingFunds() public {
        _setProfitableMintRoute();
        reserve.approve(address(executor), 300 ether);
        uint40 validUntil = uint40(block.timestamp + 1 hours);
        uint256 strategyId = _start(100 ether, 300 ether, 1 ether, validUntil);
        uint256 ownerBefore = reserve.balanceOf(address(this));
        uint256 allowanceBefore = reserve.allowance(address(this), address(executor));

        vm.warp(uint256(validUntil) + 1);
        bool success = _tryExecuteMint(strategyId, 100 ether, 100 ether, 110 ether, 132 ether);

        require(!success, "expired strategy executed");
        _assertEq(reserve.balanceOf(address(this)), ownerBefore, "expired capital moved");
        _assertEq(
            reserve.allowance(address(this), address(executor)),
            allowanceBefore,
            "expired allowance changed"
        );
        _assertStrategy(strategyId, true, 0, 300 ether);
    }

    function testOnlyOneExecutionCanSettlePerBlock() public {
        _setProfitableMintRoute();
        reserve.approve(address(executor), 300 ether);
        uint256 strategyId = _start(100 ether, 300 ether, 1 ether, 0);

        _executeMint(strategyId, 100 ether, 100 ether, 110 ether, 132 ether);
        bool success = _tryExecuteMint(strategyId, 100 ether, 100 ether, 110 ether, 132 ether);

        require(!success, "same-block execution accepted");
        _assertStrategy(strategyId, true, 1, 200 ether);
    }

    function testPerExecutionAndRemainingVolumeAreBothHardCaps() public {
        _setProfitableMintRoute();
        reserve.approve(address(executor), 150 ether);
        uint256 strategyId = _start(100 ether, 150 ether, 1 ether, 0);

        require(
            !_tryExecuteMint(strategyId, 101 ether, 101 ether, 111.1 ether, 133.32 ether),
            "per-execution cap exceeded"
        );
        _assertStrategy(strategyId, true, 0, 150 ether);

        _executeMint(strategyId, 100 ether, 100 ether, 110 ether, 132 ether);
        vm.roll(block.number + 1);
        require(
            !_tryExecuteMint(strategyId, 51 ether, 51 ether, 56.1 ether, 67.32 ether),
            "remaining volume exceeded"
        );
        _assertStrategy(strategyId, true, 1, 50 ether);
    }

    function testUnprofitableExecutionRevertsWithoutConsumingPermission() public {
        router.setRate(address(hyped), address(weth), 1, 2);
        router.setRate(address(weth), address(reserve), 1, 1);
        reserve.approve(address(executor), 300 ether);
        uint256 strategyId = _start(100 ether, 300 ether, 1 ether, 0);
        uint256 ownerBefore = reserve.balanceOf(address(this));
        uint256 allowanceBefore = reserve.allowance(address(this), address(executor));

        bool success = _tryExecuteMint(strategyId, 100 ether, 100 ether, 50 ether, 50 ether);

        require(!success, "unprofitable route executed");
        _assertEq(reserve.balanceOf(address(this)), ownerBefore, "failed route moved capital");
        _assertEq(
            reserve.allowance(address(this), address(executor)),
            allowanceBefore,
            "failed route consumed allowance"
        );
        _assertStrategy(strategyId, true, 0, 300 ether);
    }

    function testStoppedStrategyCanBeReplacedButActiveOneCannot() public {
        MockERC20 secondHyped = new MockERC20("Second hyped", "hOG2");
        bond.register(address(secondHyped), address(reserve));
        reserve.approve(address(executor), 300 ether);
        uint256 firstId = _start(100 ether, 300 ether, 1 ether, 0);

        (bool duplicateSuccess,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV3.startStrategy,
                    (address(secondHyped), 100 ether, 300 ether, 1 ether, uint40(0))
                )
            );
        require(!duplicateSuccess, "duplicate reserve strategy accepted");

        executor.stopStrategy(firstId);
        uint256 secondId = executor.startStrategy(
            address(secondHyped), 100 ether, 300 ether, 1 ether, uint40(0)
        );
        _assertEq(
            executor.activeStrategyId(address(this), address(reserve)),
            secondId,
            "replacement not activated"
        );
    }

    function testFeePolicyIsImmutable() public view {
        _assertEq(executor.protocolFeeBps(), 0, "protocol fee");
        _assertEq(executor.executorRewardBps(), 2_000, "keeper reward");
    }

    function _start(
        uint256 maxReservePerExecution,
        uint256 totalVolume,
        uint256 minProfitReserve,
        uint40 validUntil
    ) private returns (uint256) {
        return executor.startStrategy(
            address(hyped), maxReservePerExecution, totalVolume, minProfitReserve, validUntil
        );
    }

    function _setProfitableMintRoute() private {
        router.setRate(address(hyped), address(weth), 11, 10);
        router.setRate(address(weth), address(reserve), 12, 10);
    }

    function _executeMint(
        uint256 strategyId,
        uint256 amountInReserve,
        uint256 hAmountForMint,
        uint256 minimumWethOut,
        uint256 minimumReserveOut
    ) private {
        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV3.Direction.MintThenSell,
            _params(amountInReserve, hAmountForMint, minimumWethOut, 0, 0, minimumReserveOut)
        );
    }

    function _tryExecuteMint(
        uint256 strategyId,
        uint256 amountInReserve,
        uint256 hAmountForMint,
        uint256 minimumWethOut,
        uint256 minimumReserveOut
    ) private returns (bool success) {
        (success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV3.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutorV3.Direction.MintThenSell,
                        _params(
                            amountInReserve, hAmountForMint, minimumWethOut, 0, 0, minimumReserveOut
                        )
                    )
                )
            );
    }

    function _params(
        uint256 amountInReserve,
        uint256 hAmountForMint,
        uint256 minimumWethOut,
        uint256 minimumHypedOut,
        uint256 minimumBondOut,
        uint256 minimumReserveOut
    ) private pure returns (HypedArbitrageExecutorV3.ExecutionParams memory params) {
        params = HypedArbitrageExecutorV3.ExecutionParams({
            amountInReserve: amountInReserve,
            hAmountForMint: hAmountForMint,
            minimumWethOut: minimumWethOut,
            minimumHypedOut: minimumHypedOut,
            minimumBondOut: minimumBondOut,
            minimumReserveOut: minimumReserveOut
        });
    }

    function _assertStrategy(
        uint256 strategyId,
        bool expectedActive,
        uint64 expectedCount,
        uint256 expectedRemaining
    ) private view {
        (,,,, bool active, uint64 executionCount,,, uint256 remainingVolume,) =
            executor.strategies(strategyId);
        require(active == expectedActive, "active state");
        _assertEq(executionCount, expectedCount, "execution count");
        _assertEq(remainingVolume, expectedRemaining, "remaining volume");
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }
}
