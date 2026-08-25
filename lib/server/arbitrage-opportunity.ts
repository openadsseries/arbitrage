import "server-only";

import { BOND_ABI, ERC20_ABI, binaryReverseMint, mintclub } from "@mint.club/v2-sdk";
import { formatUnits, parseAbi, type Address } from "viem";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  calculateArbitrageRoute,
  getArbitrageCurveAmounts,
  getArbitrageExecutorV3,
  selectBestArbitrageSample,
  type ArbitrageOpportunity,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import { readTokenMarketPrice } from "@/lib/server/gecko-market";
import { readVerifiedMarket } from "@/lib/server/markets";

const ONCHAIN_ROUTER = "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02" as const;

const ROUTER_ABI = parseAbi([
  "function routeExactInput((address tokenIn,address tokenOut,uint256 amountSpecified) params) view returns (((address tokenIn,address tokenOut,uint24 fee,address pool,uint8 version,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[] path,uint256 amountIn,uint256 amountOut) quote)",
]);

type RouterQuote = { amountIn: bigint; amountOut: bigint };
type SuccessfulCall<T> = { status: "success"; result: T };
type FailedCall = { status: "failure"; error: Error };
type CallResult<T> = SuccessfulCall<T> | FailedCall;

function succeeded<T>(result: CallResult<T>): result is SuccessfulCall<T> {
  return result.status === "success";
}

function units(raw: bigint, decimals: number) {
  return Number(formatUnits(raw, decimals));
}

function priceBasis(input: {
  route: ReturnType<typeof calculateArbitrageRoute> | null;
  hAmount: bigint;
  hDecimals: number;
  reserveDecimals: number;
  reserveUsd: number | null;
}) {
  if (!input.route || input.hAmount <= 0n || input.reserveUsd === null) {
    return { reserveUsd: input.reserveUsd, mintClubUsd: null, poolUsd: null, hAmountRaw: input.hAmount > 0n ? input.hAmount.toString() : null };
  }
  const hUnits = units(input.hAmount, input.hDecimals);
  const amountIn = units(BigInt(input.route.amountInRaw), input.reserveDecimals);
  const amountOut = units(BigInt(input.route.amountOutRaw), input.reserveDecimals);
  if (!Number.isFinite(hUnits) || hUnits <= 0 || !Number.isFinite(amountIn) || !Number.isFinite(amountOut)) {
    return { reserveUsd: input.reserveUsd, mintClubUsd: null, poolUsd: null, hAmountRaw: input.hAmount.toString() };
  }
  const mintClubReservePerH = input.route.direction === "Mint then sell" ? amountIn / hUnits : amountOut / hUnits;
  const poolReservePerH = input.route.direction === "Mint then sell" ? amountOut / hUnits : amountIn / hUnits;
  return {
    reserveUsd: input.reserveUsd,
    mintClubUsd: mintClubReservePerH * input.reserveUsd,
    poolUsd: poolReservePerH * input.reserveUsd,
    hAmountRaw: input.hAmount.toString(),
  };
}

export async function readArbitrageOpportunity(
  hToken: Address,
  checkedAmount: bigint,
): Promise<ArbitrageOpportunity> {
  if (checkedAmount <= 0n) throw new Error("Enter an original token amount greater than zero.");

  const executor = getArbitrageExecutorV3("base");
  if (!executor) throw new Error("Continuous arbitrage is not configured on Base.");

  const client = mintclub.network("base").getPublicClient();
  const readBlock = await client.getBlockNumber();
  const market = await readVerifiedMarket("base", hToken);
  if (!market) throw new Error("This Hyped Token was not found in Mint Club on Base.");
  if (market.reserveToken.toLowerCase() === CHAINS.base.weth.toLowerCase()) {
    throw new Error("This market does not have a separate original token route.");
  }

  const [bondSteps, currentSupply, protocolFeeBps, executorRewardBps, reservePrice] = await Promise.all([
    client.readContract({
      address: CHAINS.base.mintClubBond,
      abi: BOND_ABI,
      functionName: "getSteps",
      args: [market.token],
      blockNumber: readBlock,
    }),
    client.readContract({
      address: market.token,
      abi: ERC20_ABI,
      functionName: "totalSupply",
      blockNumber: readBlock,
    }),
    client.readContract({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      functionName: "protocolFeeBps",
      blockNumber: readBlock,
    }),
    client.readContract({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      functionName: "executorRewardBps",
      blockNumber: readBlock,
    }),
    readTokenMarketPrice("base", market.reserveToken, { fresh: true }),
  ]);

  const curveAmounts = getArbitrageCurveAmounts(checkedAmount);
  const mintEntries = curveAmounts.flatMap((reserveBudget, index) => {
    try {
      const hAmount = binaryReverseMint({
        reserveAmount: reserveBudget,
        bondSteps,
        currentSupply,
        maxSupply: BigInt(market.maxSupplyRaw),
        multiFactor: 10n ** BigInt(market.decimals),
        mintRoyalty: market.mintRoyaltyBps,
        slippage: 0,
      });
      return hAmount > 0n ? [{ index, reserveBudget, hAmount }] : [];
    } catch {
      return [];
    }
  });

  const [mintReserveResults, mintedTokenSaleResults, reserveSaleResults] = await Promise.all([
    mintEntries.length === 0 ? [] : client.multicall({
      allowFailure: true,
      blockNumber: readBlock,
      contracts: mintEntries.map(({ hAmount }) => ({
        address: CHAINS.base.mintClubBond,
        abi: BOND_ABI,
        functionName: "getReserveForToken" as const,
        args: [market.token, hAmount] as const,
      })),
    }) as Promise<Array<CallResult<readonly [bigint, bigint]>>>,
    mintEntries.length === 0 ? [] : client.multicall({
      allowFailure: true,
      blockNumber: readBlock,
      contracts: mintEntries.map(({ hAmount }) => ({
        address: ONCHAIN_ROUTER,
        abi: ROUTER_ABI,
        functionName: "routeExactInput" as const,
        args: [{ tokenIn: market.token, tokenOut: CHAINS.base.weth, amountSpecified: hAmount }] as const,
      })),
    }) as Promise<Array<CallResult<RouterQuote>>>,
    client.multicall({
      allowFailure: true,
      blockNumber: readBlock,
      contracts: curveAmounts.map((amount) => ({
        address: ONCHAIN_ROUTER,
        abi: ROUTER_ABI,
        functionName: "routeExactInput" as const,
        args: [{ tokenIn: market.reserveToken, tokenOut: CHAINS.base.weth, amountSpecified: amount }] as const,
      })),
    }) as Promise<Array<CallResult<RouterQuote>>>,
  ]);

  const executableMints = mintEntries.flatMap((entry, index) => {
    const reserve = mintReserveResults[index];
    const sale = mintedTokenSaleResults[index];
    if (!reserve || !sale || !succeeded(reserve) || !succeeded(sale)) return [];
    if (reserve.result[0] <= 0n || reserve.result[0] > entry.reserveBudget || sale.result.amountOut <= 0n) return [];
    return [{ ...entry, actualReserve: reserve.result[0], wethOut: sale.result.amountOut }];
  });
  const reserveAfterMintResults = executableMints.length === 0 ? [] : await client.multicall({
    allowFailure: true,
    blockNumber: readBlock,
    contracts: executableMints.map(({ wethOut }) => ({
      address: ONCHAIN_ROUTER,
      abi: ROUTER_ABI,
      functionName: "routeExactInput" as const,
      args: [{ tokenIn: CHAINS.base.weth, tokenOut: market.reserveToken, amountSpecified: wethOut }] as const,
    })),
  }) as Array<CallResult<RouterQuote>>;

  const executableReserveSales = curveAmounts.flatMap((reserveBudget, index) => {
    const sale = reserveSaleResults[index];
    return sale && succeeded(sale) && sale.result.amountOut > 0n
      ? [{ index, reserveBudget, wethOut: sale.result.amountOut }]
      : [];
  });
  const hAfterReserveResults = executableReserveSales.length === 0 ? [] : await client.multicall({
    allowFailure: true,
    blockNumber: readBlock,
    contracts: executableReserveSales.map(({ wethOut }) => ({
      address: ONCHAIN_ROUTER,
      abi: ROUTER_ABI,
      functionName: "routeExactInput" as const,
      args: [{ tokenIn: CHAINS.base.weth, tokenOut: market.token, amountSpecified: wethOut }] as const,
    })),
  }) as Array<CallResult<RouterQuote>>;
  const executableBuys = executableReserveSales.flatMap((entry, index) => {
    const buy = hAfterReserveResults[index];
    return buy && succeeded(buy) && buy.result.amountOut > 0n
      ? [{ ...entry, hAmount: buy.result.amountOut }]
      : [];
  });
  const redeemResults = executableBuys.length === 0 ? [] : await client.multicall({
    allowFailure: true,
    blockNumber: readBlock,
    contracts: executableBuys.map(({ hAmount }) => ({
      address: CHAINS.base.mintClubBond,
      abi: BOND_ABI,
      functionName: "getRefundForTokens" as const,
      args: [market.token, hAmount] as const,
    })),
  }) as Array<CallResult<readonly [bigint, bigint]>>;

  const routesByIndex = curveAmounts.map(() => [] as ReturnType<typeof calculateArbitrageRoute>[]);
  const hAmountByIndex = curveAmounts.map(() => 0n);

  executableMints.forEach((entry, index) => {
    const result = reserveAfterMintResults[index];
    if (!result || !succeeded(result) || result.result.amountOut <= 0n) return;
    routesByIndex[entry.index].push({
      ...calculateArbitrageRoute({
      direction: "Mint then sell",
      amountIn: entry.actualReserve,
      amountOut: result.result.amountOut,
      limit: entry.reserveBudget,
      protocolFeeBps: Number(protocolFeeBps),
      executorRewardBps: Number(executorRewardBps),
      }),
      hAmountRaw: entry.hAmount.toString(),
    });
    hAmountByIndex[entry.index] = entry.hAmount;
  });
  executableBuys.forEach((entry, index) => {
    const result = redeemResults[index];
    if (!result || !succeeded(result) || result.result[0] <= 0n) return;
    routesByIndex[entry.index].push({
      ...calculateArbitrageRoute({
      direction: "Buy then redeem",
      amountIn: entry.reserveBudget,
      amountOut: result.result[0],
      limit: entry.reserveBudget,
      protocolFeeBps: Number(protocolFeeBps),
      executorRewardBps: Number(executorRewardBps),
      }),
      hAmountRaw: entry.hAmount.toString(),
    });
    if (entry.hAmount > hAmountByIndex[entry.index]) hAmountByIndex[entry.index] = entry.hAmount;
  });

  const curveSamples = curveAmounts.flatMap((reserveBudget, index) => routesByIndex[index].length > 0 ? [{
    budgetRaw: reserveBudget.toString(),
    hAmountRaw: hAmountByIndex[index].toString(),
    routes: routesByIndex[index],
  }] : []);
  if (curveSamples.length === 0) {
    throw new Error("No executable route is available for this Reserve Token amount.");
  }
  const selected = selectBestArbitrageSample(curveSamples);
  const selectedSample = selected?.sample ?? curveSamples.at(-1);
  const selectedRoute = selected?.route ?? null;
  const best = selectedRoute?.netPositive ? selectedRoute : null;
  const selectedHAmount = selectedRoute?.hAmountRaw
    ? BigInt(selectedRoute.hAmountRaw)
    : BigInt(selectedSample?.hAmountRaw ?? "0");

  return {
    chain: "base",
    hToken: market.token,
    hSymbol: market.symbol,
    reserveToken: market.reserveToken,
    reserveSymbol: market.reserveSymbol,
    reserveDecimals: market.reserveDecimals,
    checkedAmountRaw: checkedAmount.toString(),
    hAmountRaw: selectedSample?.hAmountRaw ?? "0",
    protocolFeeBps: Number(protocolFeeBps),
    executorRewardBps: Number(executorRewardBps),
    priceBasis: priceBasis({
      route: selectedRoute,
      hAmount: selectedHAmount,
      hDecimals: market.decimals,
      reserveDecimals: market.reserveDecimals,
      reserveUsd: reservePrice?.usd ?? null,
    }),
    bestDirection: best?.direction ?? null,
    routes: selectedSample?.routes ?? [],
    curveSamples,
    readBlock: readBlock.toString(),
    quotedAt: Math.floor(Date.now() / 1000),
  };
}
