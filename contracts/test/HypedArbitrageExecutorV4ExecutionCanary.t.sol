// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { HypedArbitrageExecutorV4 } from "../src/HypedArbitrageExecutorV4.sol";
import {
    IERC20Minimal,
    IMintClubBond,
    IUniswapOnchainRouter,
    RouterSwapParams,
    Quote
} from "../src/HypedArbitrageExecutor.sol";

interface VmExecutionCanary {
    function prank(address sender) external;
}

interface IERC20Allowance {
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IMintClubBondQuote is IMintClubBond {
    function getRefundForTokens(address token, uint256 tokensToBurn)
        external
        view
        returns (uint256 refundAmount, uint256 royalty);
}

contract HypedArbitrageExecutorV4ExecutionCanaryTest {
    VmExecutionCanary private constant vm =
        VmExecutionCanary(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant EXECUTOR = 0x6Aad2b4BB89813B4E0Db43170c8b314417B1D571;
    address private constant RELAY = 0x7dB6BDD7e852f5eF45260b0e5D087aE9fdf85c3C;
    address private constant MINT_CLUB = 0xc5a076cad94176c2996B32d8466Be1cE757FAa27;
    address private constant ROUTER = 0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02;
    address private constant HMT = 0x467bA2Da859648dc7C258BcF6572adE499250E6a;

    // This matches the safely retained MT from the first live assessment canary. The route
    // direction and output remain entirely dependent on the fork's current Base state.
    uint256 private constant RESERVE_AMOUNT = 1_054_924_057_473_303_162_625;
    uint256 private constant FEE_REIMBURSEMENT_WEI = 5_000_000_000_000;

    function testDeployedV4SettlesAProfitableMtExecutionAfterBaseFees() public {
        if (EXECUTOR.code.length == 0) return;

        HypedArbitrageExecutorV4 executor = HypedArbitrageExecutorV4(payable(EXECUTOR));
        IMintClubBondQuote bond = IMintClubBondQuote(MINT_CLUB);
        IUniswapOnchainRouter router = IUniswapOnchainRouter(ROUTER);
        (,,,, address reserveToken,) = bond.tokenBond(HMT);
        require(reserveToken != address(0), "reserve");

        Quote memory buy = router.routeExactInput(
            RouterSwapParams({
                tokenIn: reserveToken, tokenOut: HMT, amountSpecified: RESERVE_AMOUNT
            })
        );
        require(buy.path.length > 0 && buy.amountOut > 0, "live buy route missing");
        (uint256 reserveOut,) = bond.getRefundForTokens(HMT, buy.amountOut);
        require(reserveOut > RESERVE_AMOUNT, "live route is not gross profitable");

        address owner = address(0xCA11A7);
        // The fork impersonates the bond only to seed the isolated canary owner. Execution
        // returns purchased hMT to the bond before settling the Reserve Token refund.
        vm.prank(MINT_CLUB);
        require(IERC20Minimal(reserveToken).transfer(owner, RESERVE_AMOUNT), "seed transfer");
        uint256 ownerBefore = IERC20Minimal(reserveToken).balanceOf(owner);
        uint256 relayBefore = IERC20Minimal(reserveToken).balanceOf(RELAY);

        vm.prank(owner);
        IERC20Minimal(reserveToken).approve(EXECUTOR, RESERVE_AMOUNT);
        vm.prank(owner);
        uint256 strategyId = executor.startStrategy(
            HMT,
            RESERVE_AMOUNT,
            RESERVE_AMOUNT,
            1,
            1,
            (RESERVE_AMOUNT * 200) / 10_000,
            uint40(block.timestamp + 1 hours)
        );

        vm.prank(RELAY);
        executor.execute(
            strategyId,
            HypedArbitrageExecutorV4.Direction.BuyThenRedeem,
            HypedArbitrageExecutorV4.ExecutionParams({
                amountInReserve: RESERVE_AMOUNT,
                hAmountForMint: 0,
                minimumHypedOut: (buy.amountOut * 9_950) / 10_000,
                minimumBondOut: (reserveOut * 9_950) / 10_000,
                minimumReserveOut: (reserveOut * 9_950) / 10_000,
                feeReimbursementWei: FEE_REIMBURSEMENT_WEI
            })
        );

        uint256 ownerAfter = IERC20Minimal(reserveToken).balanceOf(owner);
        uint256 relayAfter = IERC20Minimal(reserveToken).balanceOf(RELAY);
        require(ownerAfter > ownerBefore, "owner did not keep a net profit");
        require(relayAfter > relayBefore, "relay was not reimbursed and incentivized");
        require(IERC20Allowance(reserveToken).allowance(owner, EXECUTOR) == 0, "allowance remains");
        require(executor.activeStrategyId(owner, HMT) == 0, "strategy remains active");
        (,,,, bool active,,,, uint256 remainingVolume,,,) = executor.strategies(strategyId);
        require(!active && remainingVolume == 0, "budget accounting mismatch");
    }
}
