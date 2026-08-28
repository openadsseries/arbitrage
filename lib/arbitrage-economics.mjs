const BPS = 10_000n;

function checkedBps(value, name) {
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > BPS) {
    throw new Error(`${name} is outside the basis-point range.`);
  }
  return normalized;
}

function checkedGasMarginBps(value) {
  const normalized = BigInt(value);
  if (normalized < BPS || normalized > 100_000n) {
    throw new Error("Gas margin is outside the supported range.");
  }
  return normalized;
}

export function calculateV3ProfitSplit(
  grossProfit,
  protocolFeeBps,
  executorRewardBps,
) {
  const protocolBps = checkedBps(protocolFeeBps, "Protocol fee");
  const rewardBps = checkedBps(executorRewardBps, "Executor reward");
  if (protocolBps + rewardBps > BPS) {
    throw new Error("Combined arbitrage fees exceed the gross profit.");
  }
  if (grossProfit <= 0n) {
    return {
      protocolFee: 0n,
      executorReward: 0n,
      ownerProfit: grossProfit,
      distributedProfit: grossProfit,
    };
  }

  const protocolFee = grossProfit * protocolBps / BPS;
  const executorReward = grossProfit * rewardBps / BPS;
  const ownerProfit = grossProfit - protocolFee - executorReward;
  return {
    protocolFee,
    executorReward,
    ownerProfit,
    distributedProfit: ownerProfit + executorReward,
  };
}

export function requiredGasCover(totalFee, gasMarginBps) {
  const marginBps = checkedGasMarginBps(gasMarginBps);
  return totalFee * marginBps / BPS;
}

export function rewardCoversExecutionFee(
  rewardValue,
  totalFee,
  gasMarginBps,
) {
  return rewardValue >= requiredGasCover(totalFee, gasMarginBps);
}

export function estimateV3ExecutorRewardFromOwnerProfit(
  ownerProfit,
  protocolFeeBps,
  executorRewardBps,
) {
  if (ownerProfit <= 0n) return 0n;
  const protocolBps = checkedBps(protocolFeeBps, "Protocol fee");
  const rewardBps = checkedBps(executorRewardBps, "Executor reward");
  const ownerShareBps = BPS - protocolBps - rewardBps;
  if (ownerShareBps <= 0n) return 0n;
  return ownerProfit * rewardBps / ownerShareBps;
}
