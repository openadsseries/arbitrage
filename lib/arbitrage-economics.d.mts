export type V3ProfitSplit = {
  protocolFee: bigint;
  executorReward: bigint;
  ownerProfit: bigint;
  distributedProfit: bigint;
};

export function calculateV3ProfitSplit(
  grossProfit: bigint,
  protocolFeeBps: number | bigint,
  executorRewardBps: number | bigint,
): V3ProfitSplit;

export function requiredGasCover(
  totalFee: bigint,
  gasMarginBps: number | bigint,
): bigint;

export function rewardCoversExecutionFee(
  rewardValue: bigint,
  totalFee: bigint,
  gasMarginBps: number | bigint,
): boolean;

export function estimateV3ExecutorRewardFromOwnerProfit(
  ownerProfit: bigint,
  protocolFeeBps: number | bigint,
  executorRewardBps: number | bigint,
): bigint;
