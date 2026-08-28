import { describe, expect, it } from "vitest";
import {
  calculateV3ProfitSplit,
  estimateV3ExecutorRewardFromOwnerProfit,
  requiredGasCover,
  rewardCoversExecutionFee,
} from "./arbitrage-economics.mjs";

describe("shared V3 arbitrage economics", () => {
  it("uses the same owner and executor split everywhere", () => {
    expect(calculateV3ProfitSplit(1_000n, 0, 2_000)).toEqual({
      protocolFee: 0n,
      executorReward: 200n,
      ownerProfit: 800n,
      distributedProfit: 1_000n,
    });
  });

  it("keeps losses signed and never invents a fee or reward", () => {
    expect(calculateV3ProfitSplit(-25n, 0, 2_000)).toEqual({
      protocolFee: 0n,
      executorReward: 0n,
      ownerProfit: -25n,
      distributedProfit: -25n,
    });
  });

  it("applies the relay gas margin with integer-safe math", () => {
    expect(requiredGasCover(1_000n, 10_000)).toBe(1_000n);
    expect(requiredGasCover(1_000n, 12_000)).toBe(1_200n);
    expect(rewardCoversExecutionFee(1_199n, 1_000n, 12_000)).toBe(false);
    expect(rewardCoversExecutionFee(1_200n, 1_000n, 12_000)).toBe(true);
  });

  it("derives the executor reward from a simulated owner profit", () => {
    expect(estimateV3ExecutorRewardFromOwnerProfit(800n, 0, 2_000)).toBe(200n);
    expect(estimateV3ExecutorRewardFromOwnerProfit(0n, 0, 2_000)).toBe(0n);
  });
});
