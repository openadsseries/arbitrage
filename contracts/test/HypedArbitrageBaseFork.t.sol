// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    HypedArbitrageExecutor,
    IERC20Minimal,
    IMintClubBond,
    IUniswapOnchainRouter,
    RouterSwapParams,
    Quote
} from "../src/HypedArbitrageExecutor.sol";

interface IWETHTest is IERC20Minimal {
    function deposit() external payable;
}

interface Vm {
    function deal(address account, uint256 newBalance) external;
}

contract HypedArbitrageBaseForkTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant MINT_CLUB = 0xc5a076cad94176c2996B32d8466Be1cE757FAa27;
    address internal constant ONCHAIN_ROUTER = 0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02;
    address internal constant HMT = 0x467bA2Da859648dc7C258BcF6572adE499250E6a;

    function testHmtCanJoinAcrossV3AndV4() public {
        if (MINT_CLUB.code.length == 0 || ONCHAIN_ROUTER.code.length == 0) return;
        HypedArbitrageExecutor executor =
            new HypedArbitrageExecutor(WETH, MINT_CLUB, ONCHAIN_ROUTER, 0.05 ether);

        uint256 strategyId =
            executor.startStrategy(HMT, 0.01 ether, 1, uint40(block.timestamp + 1 hours));
        (address owner, address hToken,, uint40 validUntil, bool active,,) =
            executor.strategies(strategyId);

        require(owner == address(this), "owner");
        require(hToken == HMT, "h-token");
        require(active, "inactive");
        require(validUntil > block.timestamp, "expired");
    }

    function testHmtMintThenSellWrapsV4NativeOutput() public {
        if (MINT_CLUB.code.length == 0 || ONCHAIN_ROUTER.code.length == 0) return;

        HypedArbitrageExecutor executor =
            new HypedArbitrageExecutor(WETH, MINT_CLUB, ONCHAIN_ROUTER, 0.05 ether);
        IMintClubBond bond = IMintClubBond(MINT_CLUB);
        IUniswapOnchainRouter router = IUniswapOnchainRouter(ONCHAIN_ROUTER);
        uint256 hAmount = 0.1 ether;
        (,,,, address reserveToken,) = bond.tokenBond(HMT);
        (uint256 reserveRequired,) = bond.getReserveForToken(HMT, hAmount);
        Quote memory buyReserve = router.routeExactOutput(
            RouterSwapParams({
                tokenIn: WETH, tokenOut: reserveToken, amountSpecified: reserveRequired
            })
        );
        Quote memory sellHmt = router.routeExactInput(
            RouterSwapParams({ tokenIn: HMT, tokenOut: WETH, amountSpecified: hAmount })
        );
        require(buyReserve.path.length > 0 && sellHmt.path.length > 0, "missing route");
        require(sellHmt.amountOut > buyReserve.amountIn, "route not profitable");

        uint256 amountIn = buyReserve.amountIn * 10_050 / 10_000;
        uint256 grossProfit = sellHmt.amountOut - buyReserve.amountIn;
        uint256 ownerProfit = grossProfit * 8_000 / 10_000;
        require(ownerProfit > 0, "no owner profit");

        vm.deal(address(this), 1 ether);
        IWETHTest(WETH).deposit{ value: amountIn }();
        IERC20Minimal(WETH).approve(address(executor), amountIn);
        uint256 strategyId = executor.startStrategy(
            HMT, amountIn, ownerProfit / 2, uint40(block.timestamp + 1 hours)
        );

        uint256 ownerBefore = IERC20Minimal(WETH).balanceOf(address(this));
        executor.execute(
            strategyId,
            HypedArbitrageExecutor.Direction.MintThenSell,
            amountIn,
            hAmount,
            0,
            0,
            sellHmt.amountOut * 9_950 / 10_000
        );
        uint256 ownerAfter = IERC20Minimal(WETH).balanceOf(address(this));

        require(ownerAfter > ownerBefore, "owner did not profit");
        require(IERC20Minimal(WETH).balanceOf(address(executor)) == 0, "WETH left behind");
        require(address(executor).balance == 0, "native ETH left behind");
    }

    receive() external payable { }
}
