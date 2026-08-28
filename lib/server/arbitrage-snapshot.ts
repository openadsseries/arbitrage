import "server-only";

import type { Address } from "viem";
import type { ContinuousArbitrageSnapshot } from "@/lib/arbitrage";
import { readContinuousArbitrageSnapshot } from "@/lib/server/arbitrage-v3";
import { readContinuousArbitrageSnapshotV4 } from "@/lib/server/arbitrage-v4";

export async function readUnifiedArbitrageSnapshot(
  wallet: Address,
): Promise<ContinuousArbitrageSnapshot> {
  const [v3, v4] = await Promise.all([
    readContinuousArbitrageSnapshot(wallet),
    readContinuousArbitrageSnapshotV4(wallet),
  ]);
  const writeEnabled =
    process.env.NEXT_PUBLIC_ARBITRAGE_V4_ENABLED === "true" && v4.configured;

  return {
    configured: v3.configured || v4.configured,
    executor: writeEnabled ? v4.executor : null,
    legacyExecutor: v3.executor,
    writeVersion: writeEnabled ? "v4" : null,
    deploymentBlock: writeEnabled ? v4.deploymentBlock : null,
    protocolFeeBps: writeEnabled ? v4.protocolFeeBps : 0,
    executorRewardBps: writeEnabled ? v4.executorRewardBps : 0,
    strategies: [...v4.strategies, ...v3.strategies].sort((left, right) => {
      if (left.version !== right.version) return left.version === "v4" ? -1 : 1;
      return BigInt(left.id) < BigInt(right.id) ? 1 : -1;
    }),
    executions: [...v4.executions, ...v3.executions].sort((left, right) =>
      BigInt(left.blockNumber) < BigInt(right.blockNumber) ? 1 : -1,
    ),
    readBlock: v4.readBlock ?? v3.readBlock,
    readTimestamp: Math.max(v3.readTimestamp, v4.readTimestamp),
  };
}
