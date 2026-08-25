import "server-only";

import { mintclub } from "@mint.club/v2-sdk";
import { getAddress, zeroAddress, type Address } from "viem";
import {
  ARBITRAGE_EXECUTOR_V2_ABI,
  getArbitrageDeploymentBlockV2,
  getArbitrageExecutorV2,
  type ReserveArbitrageExecution,
  type ReserveArbitrageSnapshot,
  type ReserveArbitrageStrategy,
} from "@/lib/arbitrage";

const LOG_CHUNK = 50_000n;

function blockRanges(fromBlock: bigint, toBlock: bigint) {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n;
    ranges.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
  }
  return ranges;
}

export async function readReserveArbitrageSnapshot(wallet: Address): Promise<ReserveArbitrageSnapshot> {
  const executor = getArbitrageExecutorV2("base");
  const deploymentBlock = getArbitrageDeploymentBlockV2("base");
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
  if (!bytecode || bytecode === "0x") throw new Error("The Reserve Token executor is not deployed on Base.");
  if (deploymentBlock > readBlock) throw new Error("The Reserve Token executor block is ahead of Base.");
  const ranges = blockRanges(deploymentBlock, readBlock);

  const [startedChunks, executionChunks, protocolFeeBps, executorRewardBps] = await Promise.all([
    Promise.all(ranges.map((range) => client.getContractEvents({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V2_ABI,
      eventName: "StrategyStarted",
      args: { owner: wallet },
      ...range,
    }))),
    Promise.all(ranges.map((range) => client.getContractEvents({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V2_ABI,
      eventName: "ArbitrageExecuted",
      args: { owner: wallet },
      ...range,
    }))),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_V2_ABI, functionName: "protocolFeeBps" }),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_V2_ABI, functionName: "executorRewardBps" }),
  ]);

  const started = startedChunks.flat();
  const strategyReads = await client.multicall({
    allowFailure: false,
    contracts: started.map((log) => ({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V2_ABI,
      functionName: "strategies" as const,
      args: [log.args.strategyId ?? 0n] as const,
    })),
  });

  const strategies = started.map((log, index) => {
    const [owner, hToken, reserveToken, validUntil, active, maximum, minimumProfit] = strategyReads[index];
    return {
      chain: "base",
      id: (log.args.strategyId ?? 0n).toString(),
      owner: getAddress(owner),
      hToken: getAddress(hToken),
      reserveToken: getAddress(reserveToken),
      validUntil: Number(validUntil),
      active,
      maxReservePerExecutionRaw: maximum.toString(),
      minProfitReserveRaw: minimumProfit.toString(),
    } satisfies ReserveArbitrageStrategy;
  }).sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));

  const executions = executionChunks.flat().map((log) => ({
    chain: "base",
    strategyId: (log.args.strategyId ?? 0n).toString(),
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber.toString(),
    executor: getAddress(log.args.executor ?? zeroAddress),
    direction: log.args.direction === 0 ? "Mint then sell" : "Buy then redeem",
    reserveToken: getAddress(log.args.reserveToken ?? zeroAddress),
    amountInReserveRaw: (log.args.amountInReserve ?? 0n).toString(),
    amountReturnedReserveRaw: (log.args.amountReturnedReserve ?? 0n).toString(),
    grossProfitReserveRaw: (log.args.grossProfitReserve ?? 0n).toString(),
    protocolFeeReserveRaw: (log.args.protocolFeeReserve ?? 0n).toString(),
    executorRewardReserveRaw: (log.args.executorRewardReserve ?? 0n).toString(),
    ownerProfitReserveRaw: (log.args.ownerProfitReserve ?? 0n).toString(),
  } satisfies ReserveArbitrageExecution)).sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));

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
