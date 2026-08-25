// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { HypedArbitrageExecutorV2 } from "../src/HypedArbitrageExecutorV2.sol";
import {
    IERC20Minimal,
    IMintClubBond,
    IUniswapOnchainRouter,
    RouterSwapParams,
    Quote
} from "../src/HypedArbitrageExecutor.sol";

interface IWETHV2Fork is IERC20Minimal {
    function deposit() external payable;
}

interface VmV2Fork {
    function deal(address account, uint256 newBalance) external;
}

contract V2BaseForkKeeper {
    function execute(
        HypedArbitrageExecutorV2 executor,
        uint256 strategyId,
        HypedArbitrageExecutorV2.Direction direction,
        HypedArbitrageExecutorV2.ExecutionParams calldata params
    ) external {
        executor.execute(strategyId, direction, params);
    }
}

contract HypedArbitrageExecutorV2BaseForkTest {
    VmV2Fork internal constant vm =
        VmV2Fork(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant MINT_CLUB = 0xc5a076cad94176c2996B32d8466Be1cE757FAa27;
    address internal constant ONCHAIN_ROUTER = 0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02;
    address internal constant HMT = 0x467bA2Da859648dc7C258BcF6572adE499250E6a;
    address internal constant DEPLOYED_V2 = 0xBD3aC7f06F39A3D1E3ac905A57c1CbD067be71f1;

    function testDeployedV2HasExpectedImmutablePolicy() public view {
        if (DEPLOYED_V2.code.length == 0) return;

        HypedArbitrageExecutorV2 executor = HypedArbitrageExecutorV2(payable(DEPLOYED_V2));
        require(executor.weth() == WETH, "deployed WETH");
        require(address(executor.mintClubBond()) == MINT_CLUB, "deployed bond");
        require(address(executor.onchainRouter()) == ONCHAIN_ROUTER, "deployed router");
        require(executor.protocolFeeBps() == 0, "protocol fee");
        require(executor.executorRewardBps() == 2_000, "keeper reward");
    }

    function testHmtMintThenSellSettlesProfitInReserveToken() public {
        if (MINT_CLUB.code.length == 0 || ONCHAIN_ROUTER.code.length == 0) return;

        IMintClubBond bond = IMintClubBond(MINT_CLUB);
        IUniswapOnchainRouter router = IUniswapOnchainRouter(ONCHAIN_ROUTER);
        HypedArbitrageExecutorV2 executor =
            new HypedArbitrageExecutorV2(WETH, MINT_CLUB, ONCHAIN_ROUTER);
        V2BaseForkKeeper keeper = new V2BaseForkKeeper();

        uint256 hAmount = 0.1 ether;
        (,,,, address reserveToken,) = bond.tokenBond(HMT);
        (uint256 reserveRequired,) = bond.getReserveForToken(HMT, hAmount);
        require(reserveToken != address(0) && reserveRequired > 0, "missing bond");

        Quote memory buyReserve = router.routeExactOutput(
            RouterSwapParams({
                tokenIn: WETH, tokenOut: reserveToken, amountSpecified: reserveRequired
            })
        );
        Quote memory sellHmt = router.routeExactInput(
            RouterSwapParams({ tokenIn: HMT, tokenOut: WETH, amountSpecified: hAmount })
        );
        Quote memory returnToReserve = router.routeExactInput(
            RouterSwapParams({
                tokenIn: WETH, tokenOut: reserveToken, amountSpecified: sellHmt.amountOut
            })
        );
        require(
            buyReserve.path.length > 0 && sellHmt.path.length > 0
                && returnToReserve.path.length > 0,
            "missing live route"
        );

        // A live market can move between test runs. When this direction is not profitable,
        // the unit suite still verifies the atomic loss revert and the fork test verifies the
        // deployed configuration above. Never manufacture a profitable quote in a fork test.
        if (returnToReserve.amountOut <= reserveRequired) return;

        vm.deal(address(this), 1 ether);
        IWETHV2Fork(WETH).deposit{ value: buyReserve.amountIn }();
        IERC20Minimal(WETH).approve(ONCHAIN_ROUTER, buyReserve.amountIn);
        router.swapExactOutput(buyReserve, address(this), block.timestamp, false);
        IERC20Minimal(WETH).approve(ONCHAIN_ROUTER, 0);
        require(
            IERC20Minimal(reserveToken).balanceOf(address(this)) >= reserveRequired,
            "reserve acquisition"
        );

        IERC20Minimal(reserveToken).approve(address(executor), reserveRequired);
        uint256 strategyId =
            executor.startStrategy(HMT, reserveRequired, 1, uint40(block.timestamp + 1 hours));
        uint256 ownerBefore = IERC20Minimal(reserveToken).balanceOf(address(this));

        keeper.execute(
            executor,
            strategyId,
            HypedArbitrageExecutorV2.Direction.MintThenSell,
            HypedArbitrageExecutorV2.ExecutionParams({
                amountInReserve: reserveRequired,
                hAmountForMint: hAmount,
                minimumWethOut: sellHmt.amountOut * 9_900 / 10_000,
                minimumHypedOut: 0,
                minimumBondOut: 0,
                minimumReserveOut: returnToReserve.amountOut * 9_900 / 10_000
            })
        );

        uint256 ownerAfter = IERC20Minimal(reserveToken).balanceOf(address(this));
        require(ownerAfter > ownerBefore, "owner did not profit in reserve");
        require(IERC20Minimal(reserveToken).balanceOf(address(keeper)) > 0, "keeper reward");
        require(IERC20Minimal(reserveToken).balanceOf(address(executor)) == 0, "reserve dust");
        require(IERC20Minimal(WETH).balanceOf(address(executor)) == 0, "WETH dust");
        require(IERC20Minimal(HMT).balanceOf(address(executor)) == 0, "h-token dust");
    }

    receive() external payable { }
}
