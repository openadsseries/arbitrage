import "server-only";

import { mintclub } from "@mint.club/v2-sdk";
import { unstable_cache } from "next/cache";
import { getAddress, zeroAddress, type Address } from "viem";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  getArbitrageDeploymentBlockV3,
  getArbitrageExecutorV3,
  type ContinuousArbitrageExecution,
  type ContinuousArbitrageSnapshot,
  type ContinuousArbitrageStrategy,
} from "@/lib/arbitrage";

const LOG_CHUNK = 10_000n;
const FINALITY_DEPTH = 20n;

type StartedEvent = { strategyId: string; owner: Address };
type ExecutionEvent = {
  strategyId: string;
  owner: Address;
  transactionHash: `0x${string}`;
  blockNumber: string;
  executor: Address;
  direction: "Mint then sell" | "Buy then redeem";
  reserveToken: Address;
  amountInReserveRaw: string;
  amountReturnedReserveRaw: string;
  grossProfitReserveRaw: string;
  protocolFeeReserveRaw: string;
  executorRewardReserveRaw: string;
  ownerProfitReserveRaw: string;
  remainingVolumeRaw: string;
  executionCount: string;
};

function blockRanges(fromBlock: bigint, toBlock: bigint) {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n;
    ranges.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
  }
  return ranges;
}

async function readEventRange(fromBlock: string, toBlock: string) {
  const client = mintclub.network("base").getPublicClient();
  const range = { fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) };
  const [started, executed] = await Promise.all([
    client.getContractEvents({
      address: getArbitrageExecutorV3("base")!,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      eventName: "StrategyStarted",
      ...range,
    }),
    client.getContractEvents({
      address: getArbitrageExecutorV3("base")!,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      eventName: "ArbitrageExecuted",
      ...range,
    }),
  ]);
  return {
    started: started.map(
      (log) =>
        ({
          strategyId: (log.args.strategyId ?? 0n).toString(),
          owner: getAddress(log.args.owner ?? zeroAddress),
        }) satisfies StartedEvent,
    ),
    executions: executed.map(
      (log) =>
        ({
          strategyId: (log.args.strategyId ?? 0n).toString(),
          owner: getAddress(log.args.owner ?? zeroAddress),
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          executor: getAddress(log.args.executor ?? zeroAddress),
          direction:
            log.args.direction === 0 ? "Mint then sell" : "Buy then redeem",
          reserveToken: getAddress(log.args.reserveToken ?? zeroAddress),
          amountInReserveRaw: (log.args.amountInReserve ?? 0n).toString(),
          amountReturnedReserveRaw: (
            log.args.amountReturnedReserve ?? 0n
          ).toString(),
          grossProfitReserveRaw: (log.args.grossProfitReserve ?? 0n).toString(),
          protocolFeeReserveRaw: (log.args.protocolFeeReserve ?? 0n).toString(),
          executorRewardReserveRaw: (
            log.args.executorRewardReserve ?? 0n
          ).toString(),
          ownerProfitReserveRaw: (log.args.ownerProfitReserve ?? 0n).toString(),
          remainingVolumeRaw: (log.args.remainingVolume ?? 0n).toString(),
          executionCount: (log.args.executionCount ?? 0n).toString(),
        }) satisfies ExecutionEvent,
    ),
  };
}

const readFinalizedEventRange = unstable_cache(
  readEventRange,
  ["continuous-arbitrage-v3-events-v2"],
  { revalidate: false },
);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  read: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await read(items[index]);
      }
    }),
  );
  return results;
}

export async function readContinuousArbitrageSnapshot(
  wallet: Address,
): Promise<ContinuousArbitrageSnapshot> {
  const executor = getArbitrageExecutorV3("base");
  const deploymentBlock = getArbitrageDeploymentBlockV3("base");
  if (!executor || deploymentBlock === null) {
    return {
      configured: false,
      executor,
      deploymentBlock: deploymentBlock?.toString() ?? null,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
      strategies: [],
      executions: [],
      readBlock: null,
      readTimestamp: Math.floor(Date.now() / 1_000),
    };
  }

  const client = mintclub.network("base").getPublicClient();
  const [readBlock, bytecode] = await Promise.all([
    client.getBlockNumber(),
    client.getBytecode({ address: executor }),
  ]);
  if (!bytecode || bytecode === "0x")
    throw new Error(
      "The continuous arbitrage executor is not deployed on Base.",
    );
  if (deploymentBlock > readBlock)
    throw new Error(
      "The continuous arbitrage executor block is ahead of Base.",
    );
  const ranges = blockRanges(deploymentBlock, readBlock);
  const walletAddress = getAddress(wallet);
  const finalizedBlock =
    readBlock > FINALITY_DEPTH ? readBlock - FINALITY_DEPTH : 0n;

  const [eventChunks, protocolFeeBps, executorRewardBps] = await Promise.all([
    mapWithConcurrency(ranges, 4, (range) => {
      const reader =
        range.toBlock <= finalizedBlock
          ? readFinalizedEventRange
          : readEventRange;
      return reader(range.fromBlock.toString(), range.toBlock.toString());
    }),
    client.readContract({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      functionName: "protocolFeeBps",
    }),
    client.readContract({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      functionName: "executorRewardBps",
    }),
  ]);

  const started = eventChunks
    .flatMap((chunk) => chunk.started)
    .filter(
      (event) =>
        event.owner.toLowerCase() === walletAddress.toLowerCase(),
    );
  const strategyReads = await client.multicall({
    allowFailure: false,
    contracts: started.map((log) => ({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      functionName: "strategies" as const,
      args: [BigInt(log.strategyId)] as const,
    })),
  });

  const strategies = started
    .map((log, index) => {
      const [
        owner,
        hToken,
        reserveToken,
        validUntil,
        active,
        executionCount,
        lastExecutionBlock,
        maximum,
        remainingVolume,
        minimumProfit,
      ] = strategyReads[index];
      return {
        chain: "base",
        id: log.strategyId,
        owner: getAddress(owner),
        hToken: getAddress(hToken),
        reserveToken: getAddress(reserveToken),
        validUntil: Number(validUntil),
        active,
        executionCount: executionCount.toString(),
        lastExecutionBlock: lastExecutionBlock.toString(),
        maxReservePerExecutionRaw: maximum.toString(),
        remainingVolumeRaw: remainingVolume.toString(),
        minProfitReserveRaw: minimumProfit.toString(),
      } satisfies ContinuousArbitrageStrategy;
    })
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1));

  const executions = eventChunks
    .flatMap((chunk) => chunk.executions)
    .filter(
      (event) =>
        event.owner.toLowerCase() === walletAddress.toLowerCase(),
    )
    .map(
      (log) =>
        ({
          chain: "base",
          strategyId: log.strategyId,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          executor: log.executor,
          direction: log.direction,
          reserveToken: log.reserveToken,
          amountInReserveRaw: log.amountInReserveRaw,
          amountReturnedReserveRaw: log.amountReturnedReserveRaw,
          grossProfitReserveRaw: log.grossProfitReserveRaw,
          protocolFeeReserveRaw: log.protocolFeeReserveRaw,
          executorRewardReserveRaw: log.executorRewardReserveRaw,
          ownerProfitReserveRaw: log.ownerProfitReserveRaw,
          remainingVolumeRaw: log.remainingVolumeRaw,
          executionCount: log.executionCount,
        }) satisfies ContinuousArbitrageExecution,
    )
    .sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : -1));

  return {
    configured: true,
    executor,
    deploymentBlock: deploymentBlock.toString(),
    protocolFeeBps: Number(protocolFeeBps),
    executorRewardBps: Number(executorRewardBps),
    strategies,
    executions,
    readBlock: readBlock.toString(),
    readTimestamp: Math.floor(Date.now() / 1_000),
  };
}
