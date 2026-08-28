// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { HypedArbitrageExecutorV4 } from "../src/HypedArbitrageExecutorV4.sol";
import {
    IMintClubBond,
    IUniswapOnchainRouter,
    RouterSwapParams,
    Quote
} from "../src/HypedArbitrageExecutor.sol";

contract HypedArbitrageExecutorV4BaseForkTest {
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant MINT_CLUB = 0xc5a076cad94176c2996B32d8466Be1cE757FAa27;
    address internal constant ONCHAIN_ROUTER = 0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02;
    address internal constant HMT = 0x467bA2Da859648dc7C258BcF6572adE499250E6a;
    address internal constant RELAY = address(0x1001);

    function testV4UsesRealBaseDependenciesAndKeepsStopAvailableWhilePaused() public {
        if (MINT_CLUB.code.length == 0 || ONCHAIN_ROUTER.code.length == 0) return;

        HypedArbitrageExecutorV4 executor =
            new HypedArbitrageExecutorV4(WETH, MINT_CLUB, ONCHAIN_ROUTER, RELAY, address(this));
        require(executor.weth() == WETH, "WETH");
        require(address(executor.mintClubBond()) == MINT_CLUB, "bond");
        require(address(executor.onchainRouter()) == ONCHAIN_ROUTER, "router");
        require(executor.trustedExecutor() == RELAY, "relay");
        require(executor.operatorManager() == address(this), "manager");

        uint256 strategyId = executor.startStrategy(HMT, 1 ether, 10 ether, 1, 10, 1 ether, 0);
        executor.setPaused(true);
        executor.stopStrategy(strategyId);
        (,,,, bool active,,,,,,,) = executor.strategies(strategyId);
        require(!active, "stop must remain available");
    }

    function testV4FindsBothLiveRoutesAndPricesBaseFees() public {
        if (MINT_CLUB.code.length == 0 || ONCHAIN_ROUTER.code.length == 0) return;

        HypedArbitrageExecutorV4 executor =
            new HypedArbitrageExecutorV4(WETH, MINT_CLUB, ONCHAIN_ROUTER, RELAY, address(this));
        IMintClubBond bond = IMintClubBond(MINT_CLUB);
        IUniswapOnchainRouter router = IUniswapOnchainRouter(ONCHAIN_ROUTER);
        (,,,, address reserveToken,) = bond.tokenBond(HMT);
        require(reserveToken != address(0), "reserve");

        Quote memory mintSell = router.routeExactInput(
            RouterSwapParams({ tokenIn: HMT, tokenOut: reserveToken, amountSpecified: 0.01 ether })
        );
        Quote memory buyRedeem = router.routeExactInput(
            RouterSwapParams({ tokenIn: reserveToken, tokenOut: HMT, amountSpecified: 1 ether })
        );
        require(mintSell.path.length > 0 && mintSell.amountOut > 0, "mint route");
        require(buyRedeem.path.length > 0 && buyRedeem.amountOut > 0, "redeem route");
        require(executor.quoteGasCostInReserve(reserveToken, 0.00001 ether) > 0, "fee quote");
    }
}
