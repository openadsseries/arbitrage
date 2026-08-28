import "server-only";

import { mintclub } from "@mint.club/v2-sdk";
import { unstable_cache } from "next/cache";
import { getAddress, zeroAddress, type Address } from "viem";
import {
  ARBITRAGE_EXECUTOR_V4_ABI,
  getArbitrageDeploymentBlockV4,
  getArbitrageExecutorV4,
  type ContinuousArbitrageExecution,
  type ContinuousArbitrageSnapshot,
  type ContinuousArbitrageStrategy,
} from "@/lib/arbitrage";

const LOG_CHUNK = 10_000n;
const FINALITY_DEPTH = 20n;

function blockRanges(fromBlock: bigint, toBlock: bigint) {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n;
    ranges.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
  }
  return ranges;
}

async function readEventRange(executorValue: string, fromBlock: string, toBlock: string) {
  const executor = getAddress(executorValue);
  const client = mintclub.network("base").getPublicClient();
  const range = { fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) };
  const [started, executed] = await Promise.all([
    client.getContractEvents({ address: executor, abi: ARBITRAGE_EXECUTOR_V4_ABI, eventName: "StrategyStarted", ...range }),
    client.getContractEvents({ address: executor, abi: ARBITRAGE_EXECUTOR_V4_ABI, eventName: "ArbitrageExecuted", ...range }),
  ]);
  return {
    started: started.map((log) => ({
      strategyId: (log.args.strategyId ?? 0n).toString(),
      owner: getAddress(log.args.owner ?? zeroAddress),
    })),
    executions: executed.map((log) => ({
      strategyId: (log.args.strategyId ?? 0n).toString(),
      owner: getAddress(log.args.owner ?? zeroAddress),
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      executor: getAddress(log.args.executor ?? zeroAddress),
      direction: log.args.direction === 0 ? "Mint then sell" as const : "Buy then redeem" as const,
      reserveToken: getAddress(log.args.reserveToken ?? zeroAddress),
      amountInReserveRaw: (log.args.amountInReserve ?? 0n).toString(),
      amountSpentReserveRaw: (log.args.amountSpentReserve ?? 0n).toString(),
      amountReturnedReserveRaw: (log.args.amountReturnedReserve ?? 0n).toString(),
      grossProfitReserveRaw: (log.args.grossProfitReserve ?? 0n).toString(),
      protocolFeeReserveRaw: "0",
      executorRewardReserveRaw: ((log.args.gasReimbursementReserve ?? 0n) + (log.args.executorIncentiveReserve ?? 0n)).toString(),
      gasReimbursementReserveRaw: (log.args.gasReimbursementReserve ?? 0n).toString(),
      executorIncentiveReserveRaw: (log.args.executorIncentiveReserve ?? 0n).toString(),
      ownerProfitReserveRaw: (log.args.ownerProfitReserve ?? 0n).toString(),
      remainingVolumeRaw: (log.args.remainingVolume ?? 0n).toString(),
      executionCount: (log.args.executionCount ?? 0n).toString(),
    })),
  };
}

const readFinalizedEventRange = unstable_cache(
  readEventRange,
  ["continuous-arbitrage-v4-events-v2"],
  { revalidate: false },
);

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, read: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await read(items[index]);
    }
  }));
  return results;
}

export async function readContinuousArbitrageSnapshotV4(wallet: Address): Promise<ContinuousArbitrageSnapshot> {
  const executor = getArbitrageExecutorV4("base");
  const deploymentBlock = getArbitrageDeploymentBlockV4("base");
  if (!executor || deploymentBlock === null) {
    return {
      configured: false, executor, legacyExecutor: null, writeVersion: null,
      deploymentBlock: deploymentBlock?.toString() ?? null,
      protocolFeeBps: 0, executorRewardBps: 1_000,
      strategies: [], executions: [], readBlock: null,
      readTimestamp: Math.floor(Date.now() / 1_000),
    };
  }

  const client = mintclub.network("base").getPublicClient();
  const [readBlock, bytecode] = await Promise.all([
    client.getBlockNumber(), client.getBytecode({ address: executor }),
  ]);
  if (!bytecode || bytecode === "0x") throw new Error("The V4 arbitrage executor is not deployed on Base.");
  if (deploymentBlock > readBlock) throw new Error("The V4 deployment block is ahead of Base.");

  const finalizedBlock = readBlock > FINALITY_DEPTH ? readBlock - FINALITY_DEPTH : 0n;
  const eventChunks = await mapWithConcurrency(blockRanges(deploymentBlock, readBlock), 4, (range) => {
    const reader = range.toBlock <= finalizedBlock ? readFinalizedEventRange : readEventRange;
    return reader(executor, range.fromBlock.toString(), range.toBlock.toString());
  });
  const walletAddress = getAddress(wallet);
  const started = eventChunks.flatMap((chunk) => chunk.started).filter((event) => event.owner === walletAddress);
  const [strategyReads, protocolFeeBps, executorRewardBps] = await Promise.all([
    client.multicall({
      allowFailure: false,
      contracts: started.map((event) => ({ address: executor, abi: ARBITRAGE_EXECUTOR_V4_ABI, functionName: "strategies" as const, args: [BigInt(event.strategyId)] as const })),
    }),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_V4_ABI, functionName: "protocolFeeBps" }),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_V4_ABI, functionName: "executorProfitShareBps" }),
  ]);

  const strategies = started.map((event, index) => {
    const [owner, hToken, reserveToken, validUntil, active, executionCount, lastExecutionBlock, maximum, remainingVolume, minimumProfit, maximumFee, minimumProfitBps] = strategyReads[index];
    return {
      chain: "base", version: "v4", executor, id: event.strategyId,
      owner: getAddress(owner), hToken: getAddress(hToken), reserveToken: getAddress(reserveToken),
      validUntil: Number(validUntil), active,
      executionCount: executionCount.toString(), lastExecutionBlock: lastExecutionBlock.toString(),
      maxReservePerExecutionRaw: maximum.toString(), remainingVolumeRaw: remainingVolume.toString(),
      minProfitReserveRaw: minimumProfit.toString(), minProfitBps: Number(minimumProfitBps),
      maxFeeReimbursementReserveRaw: maximumFee.toString(),
    } satisfies ContinuousArbitrageStrategy;
  }).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? 1 : -1);

  const executions = eventChunks.flatMap((chunk) => chunk.executions)
    .filter((event) => event.owner === walletAddress)
    .map((execution) => {
      const { owner, ...event } = execution;
      void owner;
      return {
        chain: "base",
        version: "v4",
        executorContract: executor,
        ...event,
      } satisfies ContinuousArbitrageExecution;
    })
    .sort((a, b) => BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : -1);

  return {
    configured: true, executor, legacyExecutor: null, writeVersion: "v4",
    deploymentBlock: deploymentBlock.toString(), protocolFeeBps: Number(protocolFeeBps),
    executorRewardBps: Number(executorRewardBps), strategies, executions,
    readBlock: readBlock.toString(), readTimestamp: Math.floor(Date.now() / 1_000),
  };
}
