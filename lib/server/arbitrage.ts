import "server-only";

import { mintclub } from "@mint.club/v2-sdk";
import { encodeAbiParameters, getAddress, keccak256, parseAbi, zeroAddress, type Address } from "viem";
import {
  ARBITRAGE_EXECUTOR_ABI,
  getArbitrageExecutorV3,
  getArbitrageDeploymentBlock,
  getArbitrageExecutor,
  type ArbitrageExecution,
  type ArbitrageMarketReadiness,
  type ArbitrageSnapshot,
  type ArbitrageStrategy,
} from "@/lib/arbitrage";
import { CHAINS, type ChainKey } from "@/lib/chains";
import type { VerifiedMarket } from "@/lib/onchain-types";
import { readVerifiedMarket } from "@/lib/server/markets";
const ONCHAIN_ROUTER = "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02" as const;
const ONCHAIN_ROUTER_ABI = parseAbi([
  "function routeExactInput((address tokenIn,address tokenOut,uint256 amountSpecified) params) view returns (((address tokenIn,address tokenOut,uint24 fee,address pool,uint8 version,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[] path,uint256 amountIn,uint256 amountOut) quote)",
]);
const LOG_CHUNK = 50_000n;

function publicClient(chain: ChainKey) {
  return mintclub.network(chain).getPublicClient();
}

async function readExecutableMarket(
  client: ReturnType<typeof publicClient>,
  token: Address,
  fallbackReference: string | null,
) {
  try {
    const quote = await client.readContract({
      address: ONCHAIN_ROUTER,
      abi: ONCHAIN_ROUTER_ABI,
      functionName: "routeExactInput",
      args: [{ tokenIn: CHAINS.base.weth, tokenOut: token, amountSpecified: 1_000_000_000_000n }],
    });
    const first = quote.path[0];
    if (!first || quote.amountOut === 0n) return null;
    const protocol = first.version === 0 ? "V2" : first.version === 1 ? "V3" : first.version === 2 ? "V4" : null;
    if (!protocol) return null;
    const v4PoolId = first.version === 2
      ? keccak256(encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
        [first.key.currency0, first.key.currency1, first.key.fee, first.key.tickSpacing, first.key.hooks],
      ))
      : null;
    return {
      protocol,
      reference: first.version === 2 ? fallbackReference ?? v4PoolId : first.pool,
      fee: first.version === 2 ? first.key.fee : first.fee,
    } as const;
  } catch {
    return null;
  }
}

function blockRanges(fromBlock: bigint, toBlock: bigint) {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    ranges.push({ fromBlock: start, toBlock: start + LOG_CHUNK - 1n > toBlock ? toBlock : start + LOG_CHUNK - 1n });
  }
  return ranges;
}

export async function readArbitrageSnapshot(wallet: Address): Promise<ArbitrageSnapshot> {
  const chain: ChainKey = "base";
  const executor = getArbitrageExecutor(chain);
  const deploymentBlock = getArbitrageDeploymentBlock(chain);
  if (!executor || deploymentBlock === null) {
    return {
      configured: false,
      executor,
      deploymentBlock: deploymentBlock?.toString() ?? null,
      protocolFeeBps: 0,
      executorRewardBps: 0,
      globalMaxWethPerExecutionRaw: "0",
      strategies: [],
      executions: [],
      readBlock: null,
      readTimestamp: Math.floor(Date.now() / 1000),
    };
  }

  const client = publicClient(chain);
  const [readBlock, bytecode] = await Promise.all([
    client.getBlockNumber(),
    client.getBytecode({ address: executor }),
  ]);
  if (!bytecode) throw new Error("The configured execution contract is not deployed on Base.");
  if (deploymentBlock > readBlock) throw new Error("The execution contract block is ahead of Base.");
  const ranges = blockRanges(deploymentBlock, readBlock);

  const [
    startedChunks,
    executionChunks,
    protocolFeeBps,
    executorRewardBps,
    globalMaxWethPerExecution,
  ] = await Promise.all([
    Promise.all(ranges.map((range) => client.getContractEvents({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_ABI,
      eventName: "StrategyStarted",
      args: { owner: wallet },
      ...range,
    }))),
    Promise.all(ranges.map((range) => client.getContractEvents({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_ABI,
      eventName: "ArbitrageExecuted",
      args: { owner: wallet },
      ...range,
    }))),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_ABI, functionName: "protocolFeeBps" }),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_ABI, functionName: "executorRewardBps" }),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_ABI, functionName: "globalMaxWethPerExecution" }),
  ]);
  const started = startedChunks.flat();
  const strategyReads = await client.multicall({
    allowFailure: false,
    contracts: started.map((log) => ({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_ABI,
      functionName: "strategies" as const,
      args: [log.args.strategyId ?? 0n] as const,
    })),
  });
  const strategies = started.map((log, index) => {
    const result = strategyReads[index];
    const [owner, hToken, reserveToken, validUntil, active, maxWeth, minProfit] = result;
    return {
      chain,
      id: (log.args.strategyId ?? 0n).toString(),
      owner: getAddress(owner),
      hToken: getAddress(hToken),
      reserveToken: getAddress(reserveToken),
      validUntil: Number(validUntil),
      active,
      maxWethPerExecutionRaw: maxWeth.toString(),
      minProfitRaw: minProfit.toString(),
    } satisfies ArbitrageStrategy;
  }).sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));

  const executions = executionChunks.flat().map((log) => ({
    chain,
    strategyId: (log.args.strategyId ?? 0n).toString(),
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber.toString(),
    executor: getAddress(log.args.executor ?? zeroAddress),
    direction: log.args.direction === 0 ? "Mint then sell" : "Buy then redeem",
    amountInRaw: (log.args.amountIn ?? 0n).toString(),
    amountReturnedRaw: (log.args.amountReturned ?? 0n).toString(),
    grossProfitRaw: (log.args.grossProfit ?? 0n).toString(),
    protocolFeeRaw: (log.args.protocolFee ?? 0n).toString(),
    executorRewardRaw: (log.args.executorReward ?? 0n).toString(),
    ownerProfitRaw: (log.args.ownerProfit ?? 0n).toString(),
  } satisfies ArbitrageExecution)).sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));

  return {
    configured: true,
    executor,
    deploymentBlock: deploymentBlock.toString(),
    protocolFeeBps: Number(protocolFeeBps),
    executorRewardBps: Number(executorRewardBps),
    globalMaxWethPerExecutionRaw: globalMaxWethPerExecution.toString(),
    strategies,
    executions,
    readBlock: readBlock.toString(),
    readTimestamp: Math.floor(Date.now() / 1000),
  };
}

export async function prepareArbitrageStrategy(chain: ChainKey, hToken: Address) {
  const readiness = await readArbitrageMarketReadiness(chain, hToken);
  if (!readiness.ready || !readiness.executor) {
    throw new Error(readiness.blockers[0] ?? "This market is not ready for arbitrage.");
  }

  return {
    chain: readiness.chain,
    executor: readiness.executor,
    hToken: readiness.hToken,
    hSymbol: readiness.hSymbol,
    reserveToken: readiness.reserveToken,
    reserveSymbol: readiness.reserveSymbol,
    readBlock: readiness.readBlock,
  };
}

export async function readArbitrageMarketReadiness(
  chain: ChainKey,
  hToken: Address,
): Promise<ArbitrageMarketReadiness> {
  if (chain !== "base") throw new Error("Arbitrage is available on Base first.");
  const market = await readVerifiedMarket("base", hToken);
  if (!market) throw new Error("This Hyped Token was not found in Mint Club on Base.");

  return readArbitrageMarketReadinessForMarket(market);
}

export async function readArbitrageMarketReadinessForMarket(
  market: VerifiedMarket,
): Promise<ArbitrageMarketReadiness> {
  if (market.chain !== "base") throw new Error("Arbitrage is available on Base first.");
  const client = publicClient("base");

  const executor = getArbitrageExecutorV3("base");
  const [originalMarket, hypedExecutableMarket, executorCode] = await Promise.all([
    readExecutableMarket(client, market.reserveToken, null),
    readExecutableMarket(client, market.token, market.directMarket?.reference ?? null),
    executor ? client.getBytecode({ address: executor }) : Promise.resolve(undefined),
  ]);
  const directHypedMarket = market.directMarket;
  const executorReady = Boolean(executor && executorCode && executorCode !== "0x");
  const blockers: string[] = [];
  if (!originalMarket) blockers.push(`${market.reserveSymbol} needs an executable Uniswap market.`);
  if (market.directMarketStatus === "unavailable") blockers.push(`${market.symbol} liquidity could not be verified.`);
  else if (!directHypedMarket || !hypedExecutableMarket) blockers.push(`${market.symbol} needs an executable Uniswap market.`);
  if (!executorReady) blockers.push("Continuous arbitrage is not live on Base yet.");

  return {
    chain: "base",
    hToken: market.token,
    hSymbol: market.symbol,
    reserveToken: market.reserveToken,
    reserveSymbol: market.reserveSymbol,
    executor,
    executorReady,
    globalMaxWethPerExecutionRaw: null,
    originalMarket: {
      ready: Boolean(originalMarket),
      pool: originalMarket?.reference ?? null,
      fee: originalMarket?.fee ?? null,
      liquidityRaw: "0",
      protocol: originalMarket?.protocol ?? null,
      executorCompatible: Boolean(originalMarket),
    },
    hypedMarket: {
      ready: Boolean(directHypedMarket),
      pool: directHypedMarket?.reference ?? null,
      fee: hypedExecutableMarket?.fee ?? directHypedMarket?.fee ?? null,
      liquidityRaw: directHypedMarket?.liquidityRaw ?? "0",
      protocol: directHypedMarket?.protocol ?? null,
      executorCompatible: Boolean(hypedExecutableMarket),
    },
    ready: Boolean(originalMarket && directHypedMarket && hypedExecutableMarket && executorReady),
    blockers,
    readBlock: market.blockNumber,
  };
}
