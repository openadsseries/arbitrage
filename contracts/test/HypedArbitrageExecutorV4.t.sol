// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { HypedArbitrageExecutorV4 } from "../src/HypedArbitrageExecutorV4.sol";
import { MockERC20, MockRouter, MockBond } from "./HypedArbitrageExecutor.t.sol";

interface VmV4 {
    function roll(uint256 newHeight) external;
    function txGasPrice(uint256 newGasPrice) external;
    function etch(address target, bytes calldata code) external;
}

contract MockBaseGasPriceOracle {
    function getL1FeeUpperBound(uint256) external pure returns (uint256) {
        return 2 ether;
    }

    function getOperatorFee(uint256) external pure returns (uint256) {
        return 1 ether;
    }
}

contract MockZeroBaseGasPriceOracle {
    function getL1FeeUpperBound(uint256) external pure returns (uint256) {
        return 0;
    }

    function getOperatorFee(uint256) external pure returns (uint256) {
        return 0;
    }
}

contract V4Keeper {
    function execute(
        HypedArbitrageExecutorV4 executor,
        uint256 strategyId,
        HypedArbitrageExecutorV4.Direction direction,
        HypedArbitrageExecutorV4.ExecutionParams calldata params
    ) external returns (uint256) {
        return executor.execute(strategyId, direction, params);
    }

    function tryExecute(
        HypedArbitrageExecutorV4 executor,
        uint256 strategyId,
        HypedArbitrageExecutorV4.Direction direction,
        HypedArbitrageExecutorV4.ExecutionParams calldata params
    ) external returns (bool success) {
        (success,) = address(executor)
            .call(abi.encodeCall(HypedArbitrageExecutorV4.execute, (strategyId, direction, params)));
    }

    function acceptExecutor(HypedArbitrageExecutorV4 executor) external {
        executor.acceptTrustedExecutor();
    }

    function tryStop(HypedArbitrageExecutorV4 executor, uint256 strategyId)
        external
        returns (bool success)
    {
        (success,) = address(executor)
            .call(abi.encodeCall(HypedArbitrageExecutorV4.stopStrategy, (strategyId)));
    }

    function trySetPaused(HypedArbitrageExecutorV4 executor, bool nextPaused)
        external
        returns (bool success)
    {
        (success,) = address(executor)
            .call(abi.encodeCall(HypedArbitrageExecutorV4.setPaused, (nextPaused)));
    }
}

contract HypedArbitrageExecutorV4Test {
    VmV4 internal constant vm = VmV4(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 internal weth;
    MockERC20 internal reserve;
    MockERC20 internal hyped;
    MockRouter internal router;
    MockBond internal bond;
    V4Keeper internal keeper;
    HypedArbitrageExecutorV4 internal executor;

    function setUp() public {
        weth = new MockERC20("Wrapped Ether", "WETH");
        reserve = new MockERC20("Reserve", "OG");
        hyped = new MockERC20("Hyped", "hOG");
        router = new MockRouter();
        bond = new MockBond();
        keeper = new V4Keeper();
        bond.register(address(hyped), address(reserve));
        executor = new HypedArbitrageExecutorV4(
            address(weth), address(bond), address(router), address(keeper), address(this)
        );
        MockZeroBaseGasPriceOracle oracle = new MockZeroBaseGasPriceOracle();
        vm.etch(executor.baseGasPriceOracle(), address(oracle).code);

        reserve.mint(address(this), 1_000 ether);
        reserve.mint(address(bond), 10_000 ether);
        bond.seedReserve(address(hyped), 10_000 ether);
    }

    function testMintThenSellUsesDirectRouteWithoutWethPool() public {
        router.setRate(address(hyped), address(reserve), 132, 100);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 132 ether, 0)
        );

        _assertEq(reserve.balanceOf(address(this)), 1_028.8 ether, "owner direct return");
        _assertEq(reserve.balanceOf(address(keeper)), 3.2 ether, "keeper residual share");
        _assertEq(weth.balanceOf(address(executor)), 0, "unexpected WETH balance");
    }

    function testBuyThenRedeemUsesDirectRouteWithoutWethPool() public {
        router.setRate(address(reserve), address(hyped), 12, 10);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.BuyThenRedeem,
            _params(100 ether, 0, 120 ether, 120 ether, 0, 0)
        );

        _assertEq(reserve.balanceOf(address(this)), 1_018 ether, "owner direct return");
        _assertEq(reserve.balanceOf(address(keeper)), 2 ether, "keeper residual share");
    }

    function testGasIsReimbursedBeforeRemainingProfitIsSplit() public {
        router.setRate(address(hyped), address(reserve), 2, 1);
        router.setRate(address(weth), address(reserve), 1, 1);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);
        vm.txGasPrice(1 gwei);

        uint256 ownerBefore = reserve.balanceOf(address(this));
        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 200 ether, 0.0001 ether)
        );

        uint256 keeperReturn = reserve.balanceOf(address(keeper));
        uint256 ownerProfit = reserve.balanceOf(address(this)) - ownerBefore;
        require(keeperReturn > 10 ether, "gas was not reimbursed before incentive");
        require(ownerProfit > 1 ether, "owner minimum was not preserved");
        _assertEq(ownerProfit + keeperReturn, 100 ether, "profit allocation mismatch");
    }

    function testBaseL1AndOperatorFeesAreIncludedWhenL2GasPriceIsZero() public {
        MockBaseGasPriceOracle oracle = new MockBaseGasPriceOracle();
        vm.etch(executor.baseGasPriceOracle(), address(oracle).code);
        router.setRate(address(hyped), address(reserve), 2, 1);
        router.setRate(address(weth), address(reserve), 1, 1);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);
        vm.txGasPrice(0);

        uint256 ownerBefore = reserve.balanceOf(address(this));
        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 200 ether, 3 ether)
        );

        uint256 keeperReturn = reserve.balanceOf(address(keeper));
        uint256 ownerProfit = reserve.balanceOf(address(this)) - ownerBefore;
        require(keeperReturn >= 3 ether, "Base fees were not reimbursed");
        _assertEq(ownerProfit + keeperReturn, 100 ether, "Base fee allocation mismatch");
    }

    function testUserFeeCapCannotBeExceeded() public {
        MockBaseGasPriceOracle oracle = new MockBaseGasPriceOracle();
        vm.etch(executor.baseGasPriceOracle(), address(oracle).code);
        router.setRate(address(hyped), address(reserve), 2, 1);
        router.setRate(address(weth), address(reserve), 1, 1);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId =
            _startWithPolicy(address(hyped), 100 ether, 100 ether, 1 ether, 100, 2 ether);

        bool success = keeper.tryExecute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 200 ether, 3 ether)
        );

        require(!success, "fee cap was exceeded");
        _assertEq(reserve.balanceOf(address(this)), 1_000 ether, "fee cap moved owner funds");
    }

    function testRelayFeeClaimCannotExceedBaseUpperBound() public {
        router.setRate(address(hyped), address(reserve), 2, 1);
        router.setRate(address(weth), address(reserve), 1, 1);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);

        bool success = keeper.tryExecute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 200 ether, 1)
        );

        require(!success, "fee claim exceeded Base upper bound");
        _assertEq(reserve.balanceOf(address(this)), 1_000 ether, "fee claim moved owner funds");
    }

    function testNonzeroFeeNeedsAReserveValuationRoute() public {
        MockBaseGasPriceOracle oracle = new MockBaseGasPriceOracle();
        vm.etch(executor.baseGasPriceOracle(), address(oracle).code);
        router.setRate(address(hyped), address(reserve), 2, 1);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);

        bool success = keeper.tryExecute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 200 ether, 1 ether)
        );

        require(!success, "fee executed without Reserve valuation route");
        _assertEq(reserve.balanceOf(address(this)), 1_000 ether, "missing route moved owner funds");
    }

    function testPercentageProfitFloorProtectsLargerExecution() public {
        router.setRate(address(hyped), address(reserve), 101, 100);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId =
            _startWithPolicy(address(hyped), 100 ether, 100 ether, 0.1 ether, 100, 10 ether);

        bool success = keeper.tryExecute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 101 ether, 0)
        );

        require(!success, "percentage profit floor was bypassed");
    }

    function testMintBudgetUsesReserveActuallySpent() public {
        router.setRate(address(hyped), address(reserve), 15, 10);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 80 ether, 0, 0, 120 ether, 0)
        );

        (,,,,,,,, uint256 remainingVolume,,,) = executor.strategies(strategyId);
        _assertEq(remainingVolume, 20 ether, "unused reserve consumed budget");
        _assertEq(reserve.balanceOf(address(this)), 1_036 ether, "unused reserve not returned");
        _assertEq(reserve.balanceOf(address(keeper)), 4 ether, "keeper profit mismatch");
    }

    function testExecutionRevertsWhenFeesConsumeProtectedProfit() public {
        router.setRate(address(hyped), address(reserve), 105, 100);
        router.setRate(address(weth), address(reserve), 1, 1);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);
        vm.txGasPrice(1_000_000 gwei);

        bool success = keeper.tryExecute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 105 ether, 5 ether)
        );

        require(!success, "fees consumed protected profit");
        _assertEq(reserve.balanceOf(address(this)), 1_000 ether, "failed route moved owner funds");
    }

    function testActiveStrategyKeyUsesOwnerAndHypedToken() public {
        MockERC20 secondHyped = new MockERC20("Second Hyped", "hOG2");
        bond.register(address(secondHyped), address(reserve));
        reserve.approve(address(executor), 200 ether);

        uint256 firstId = _start(address(hyped), 100 ether, 100 ether, 1 ether);
        uint256 secondId = _start(address(secondHyped), 100 ether, 100 ether, 1 ether);

        _assertEq(
            executor.activeStrategyId(address(this), address(hyped)), firstId, "first h-token key"
        );
        _assertEq(
            executor.activeStrategyId(address(this), address(secondHyped)),
            secondId,
            "second h-token key"
        );
    }

    function testOnlyTrustedExecutorCanRunStrategy() public {
        router.setRate(address(hyped), address(reserve), 132, 100);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);

        (bool success,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV4.execute,
                    (
                        strategyId,
                        HypedArbitrageExecutorV4.Direction.MintThenSell,
                        _params(100 ether, 100 ether, 0, 0, 132 ether, 0)
                    )
                )
            );

        require(!success, "untrusted executor accepted");
    }

    function testChangedReserveCannotUseOldPermission() public {
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);
        MockERC20 replacement = new MockERC20("Replacement", "NEW");
        bond.setReserve(address(hyped), address(replacement));

        bool success = keeper.tryExecute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 132 ether, 0)
        );

        require(!success, "changed reserve used stale strategy");
        _assertEq(reserve.balanceOf(address(this)), 1_000 ether, "changed reserve moved funds");
    }

    function testOnlyOwnerCanStopStrategy() public {
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);

        require(!keeper.tryStop(executor, strategyId), "non-owner stopped strategy");
        (,,,, bool active,,,,,,,) = executor.strategies(strategyId);
        require(active, "strategy changed after non-owner stop");
    }

    function testTrustedExecutorRotationRequiresBothSteps() public {
        V4Keeper nextKeeper = new V4Keeper();
        executor.proposeTrustedExecutor(address(nextKeeper));
        _assertEq(
            uint256(uint160(executor.trustedExecutor())),
            uint256(uint160(address(keeper))),
            "executor changed before acceptance"
        );

        nextKeeper.acceptExecutor(executor);

        _assertEq(
            uint256(uint160(executor.trustedExecutor())),
            uint256(uint160(address(nextKeeper))),
            "executor rotation failed"
        );
    }

    function testPauseBlocksStartAndExecutionButNotStop() public {
        router.setRate(address(hyped), address(reserve), 132, 100);
        reserve.approve(address(executor), 100 ether);
        uint256 strategyId = _start(address(hyped), 100 ether, 100 ether, 1 ether);
        executor.setPaused(true);

        bool executionSuccess = keeper.tryExecute(
            executor,
            strategyId,
            HypedArbitrageExecutorV4.Direction.MintThenSell,
            _params(100 ether, 100 ether, 0, 0, 132 ether, 0)
        );
        (bool startSuccess,) = address(executor)
            .call(
                abi.encodeCall(
                    HypedArbitrageExecutorV4.startStrategy,
                    (address(hyped), 10 ether, 10 ether, 0.1 ether, uint16(100), 1 ether, uint40(0))
                )
            );

        require(!executionSuccess, "paused execution succeeded");
        require(!startSuccess, "paused strategy started");
        executor.stopStrategy(strategyId);
        _assertEq(executor.activeStrategyId(address(this), address(hyped)), 0, "stop was blocked");
    }

    function testOnlyOperatorManagerCanPause() public {
        require(!keeper.trySetPaused(executor, true), "relay paused executor");
        require(!executor.paused(), "unauthorized pause changed state");

        executor.setPaused(true);
        require(executor.paused(), "manager pause failed");
        executor.setPaused(false);
        require(!executor.paused(), "manager unpause failed");
    }

    function _start(address hToken, uint256 perExecution, uint256 totalVolume, uint256 minProfit)
        private
        returns (uint256)
    {
        return _startWithPolicy(hToken, perExecution, totalVolume, minProfit, 100, 100 ether);
    }

    function _startWithPolicy(
        address hToken,
        uint256 perExecution,
        uint256 totalVolume,
        uint256 minProfit,
        uint16 minProfitBps,
        uint256 maxFeeReimbursement
    ) private returns (uint256) {
        return executor.startStrategy(
            hToken, perExecution, totalVolume, minProfit, minProfitBps, maxFeeReimbursement, 0
        );
    }

    function _params(
        uint256 amountInReserve,
        uint256 hAmountForMint,
        uint256 minimumHypedOut,
        uint256 minimumBondOut,
        uint256 minimumReserveOut,
        uint256 feeReimbursementWei
    ) private pure returns (HypedArbitrageExecutorV4.ExecutionParams memory) {
        return HypedArbitrageExecutorV4.ExecutionParams({
            amountInReserve: amountInReserve,
            hAmountForMint: hAmountForMint,
            minimumHypedOut: minimumHypedOut,
            minimumBondOut: minimumBondOut,
            minimumReserveOut: minimumReserveOut,
            feeReimbursementWei: feeReimbursementWei
        });
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }
}
