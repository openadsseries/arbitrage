import { getAddress, isAddress, parseAbi, type Address } from "viem";
import type { ChainKey } from "@/lib/chains";

// The user chooses a bounded budget; route, executable size and direction are
// selected from live onchain quotes by the executor service.
export const ARBITRAGE_ONE_CLICK_VALIDITY_SECONDS = 24 * 60 * 60;

export const ARBITRAGE_EXECUTOR_ABI = parseAbi([
  "function startStrategy(address hToken,uint256 maxWethPerExecution,uint256 minProfit,uint40 validUntil) returns (uint256 strategyId)",
  "function stopStrategy(uint256 strategyId)",
  "function strategies(uint256 strategyId) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint256 maxWethPerExecution,uint256 minProfit)",
  "function protocolFeeBps() view returns (uint16)",
  "function executorRewardBps() view returns (uint16)",
  "function globalMaxWethPerExecution() view returns (uint256)",
  "event StrategyStarted(uint256 indexed strategyId,address indexed owner,address indexed hToken,address reserveToken,uint256 maxWethPerExecution,uint256 minProfit,uint40 validUntil)",
  "event StrategyStopped(uint256 indexed strategyId,address indexed owner)",
  "event ArbitrageExecuted(uint256 indexed strategyId,address indexed owner,address indexed executor,uint8 direction,uint256 amountIn,uint256 amountReturned,uint256 grossProfit,uint256 protocolFee,uint256 executorReward,uint256 ownerProfit)",
]);

export const ARBITRAGE_EXECUTOR_V2_ABI = parseAbi([
  "function startStrategy(address hToken,uint256 maxReservePerExecution,uint256 minProfitReserve,uint40 validUntil) returns (uint256 strategyId)",
  "function stopStrategy(uint256 strategyId)",
  "function strategies(uint256 strategyId) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint256 maxReservePerExecution,uint256 minProfitReserve)",
  "function activeStrategyId(address owner,address reserveToken) view returns (uint256)",
  "function protocolFeeBps() view returns (uint16)",
  "function executorRewardBps() view returns (uint16)",
  "event StrategyStarted(uint256 indexed strategyId,address indexed owner,address indexed hToken,address reserveToken,uint256 maxReservePerExecution,uint256 minProfitReserve,uint40 validUntil)",
  "event StrategyStopped(uint256 indexed strategyId,address indexed owner)",
  "event ArbitrageExecuted(uint256 indexed strategyId,address indexed owner,address indexed executor,uint8 direction,address reserveToken,uint256 amountInReserve,uint256 amountReturnedReserve,uint256 grossProfitReserve,uint256 protocolFeeReserve,uint256 executorRewardReserve,uint256 ownerProfitReserve)",
]);

export const ARBITRAGE_EXECUTOR_V3_ABI = parseAbi([
  "function startStrategy(address hToken,uint256 maxReservePerExecution,uint256 totalVolume,uint256 minProfitReserve,uint40 validUntil) returns (uint256 strategyId)",
  "function stopStrategy(uint256 strategyId)",
  "function execute(uint256 strategyId,uint8 direction,(uint256 amountInReserve,uint256 hAmountForMint,uint256 minimumWethOut,uint256 minimumHypedOut,uint256 minimumBondOut,uint256 minimumReserveOut) params) returns (uint256 ownerReturnReserve)",
  "function strategies(uint256 strategyId) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint64 executionCount,uint64 lastExecutionBlock,uint256 maxReservePerExecution,uint256 remainingVolume,uint256 minProfitReserve)",
  "function activeStrategyId(address owner,address reserveToken) view returns (uint256)",
  "function protocolFeeBps() view returns (uint16)",
  "function executorRewardBps() view returns (uint16)",
  "event StrategyStarted(uint256 indexed strategyId,address indexed owner,address indexed hToken,address reserveToken,uint256 maxReservePerExecution,uint256 totalVolume,uint256 minProfitReserve,uint40 validUntil)",
  "event StrategyStopped(uint256 indexed strategyId,address indexed owner)",
  "event ArbitrageExecuted(uint256 indexed strategyId,address indexed owner,address indexed executor,uint8 direction,address reserveToken,uint256 amountInReserve,uint256 amountReturnedReserve,uint256 grossProfitReserve,uint256 protocolFeeReserve,uint256 executorRewardReserve,uint256 ownerProfitReserve,uint256 remainingVolume,uint64 executionCount)",
]);

export const ERC20_PERMISSION_ABI = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

export type ArbitrageStrategy = {
  chain: ChainKey;
  id: string;
  owner: Address;
  hToken: Address;
  reserveToken: Address;
  validUntil: number;
  active: boolean;
  maxWethPerExecutionRaw: string;
  minProfitRaw: string;
};

export type ArbitrageExecution = {
  chain: ChainKey;
  strategyId: string;
  transactionHash: `0x${string}`;
  blockNumber: string;
  executor: Address;
  direction: "Mint then sell" | "Buy then redeem";
  amountInRaw: string;
  amountReturnedRaw: string;
  grossProfitRaw: string;
  protocolFeeRaw: string;
  executorRewardRaw: string;
  ownerProfitRaw: string;
};

export type ArbitrageSnapshot = {
  configured: boolean;
  executor: Address | null;
  deploymentBlock: string | null;
  protocolFeeBps: number;
  executorRewardBps: number;
  globalMaxWethPerExecutionRaw: string;
  strategies: ArbitrageStrategy[];
  executions: ArbitrageExecution[];
  readBlock: string | null;
  readTimestamp: number;
};

export type ReserveArbitrageStrategy = {
  chain: "base";
  id: string;
  owner: Address;
  hToken: Address;
  reserveToken: Address;
  validUntil: number;
  active: boolean;
  maxReservePerExecutionRaw: string;
  minProfitReserveRaw: string;
};

export type ReserveArbitrageExecution = {
  chain: "base";
  strategyId: string;
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
};

export type ReserveArbitrageSnapshot = {
  configured: boolean;
  executor: Address | null;
  deploymentBlock: string | null;
  protocolFeeBps: number;
  executorRewardBps: number;
  strategies: ReserveArbitrageStrategy[];
  executions: ReserveArbitrageExecution[];
  readBlock: string | null;
  readTimestamp: number;
};

export type ContinuousArbitrageStrategy = {
  chain: "base";
  id: string;
  owner: Address;
  hToken: Address;
  reserveToken: Address;
  validUntil: number;
  active: boolean;
  executionCount: string;
  lastExecutionBlock: string;
  maxReservePerExecutionRaw: string;
  remainingVolumeRaw: string;
  minProfitReserveRaw: string;
};

export type ContinuousArbitrageExecution = ReserveArbitrageExecution & {
  remainingVolumeRaw: string;
  executionCount: string;
};

export type ContinuousArbitrageSnapshot = {
  configured: boolean;
  executor: Address | null;
  deploymentBlock: string | null;
  protocolFeeBps: number;
  executorRewardBps: number;
  strategies: ContinuousArbitrageStrategy[];
  executions: ContinuousArbitrageExecution[];
  readBlock: string | null;
  readTimestamp: number;
};

export type ArbitrageMarketReadiness = {
  chain: "base";
  hToken: Address;
  hSymbol: string;
  reserveToken: Address;
  reserveSymbol: string;
  executor: Address | null;
  executorReady: boolean;
  globalMaxWethPerExecutionRaw: string | null;
  originalMarket: {
    ready: boolean;
    pool: string | null;
    fee: number | null;
    liquidityRaw: string;
    protocol: "V2" | "V3" | "V4" | null;
    executorCompatible: boolean;
  };
  hypedMarket: {
    ready: boolean;
    pool: string | null;
    fee: number | null;
    liquidityRaw: string;
    protocol: "V2" | "V3" | "V4" | null;
    executorCompatible: boolean;
  };
  ready: boolean;
  blockers: string[];
  readBlock: string;
};

export type ArbitrageOpportunityRoute = {
  direction: "Mint then sell" | "Buy then redeem";
  amountInRaw: string;
  amountOutRaw: string;
  hAmountRaw?: string;
  grossDifferenceRaw: string;
  ownerDifferenceRaw: string;
  netReturnBps: number;
  withinLimit: boolean;
  netPositive: boolean;
  /** Kept for tabs opened before the live-quote naming update. */
  gapBps: number;
  /** Kept for tabs opened before the live-quote naming update. */
  profitable: boolean;
};

export type ArbitrageOpportunitySample = {
  budgetRaw: string;
  hAmountRaw: string;
  routes: ArbitrageOpportunityRoute[];
};

export type ArbitrageOpportunity = {
  chain: "base";
  hToken: Address;
  hSymbol: string;
  reserveToken: Address;
  reserveSymbol: string;
  reserveDecimals: number;
  checkedAmountRaw: string;
  hAmountRaw: string;
  protocolFeeBps: number;
  executorRewardBps: number;
  priceBasis: {
    reserveUsd: number | null;
    mintClubUsd: number | null;
    poolUsd: number | null;
    hAmountRaw: string | null;
  };
  bestDirection: ArbitrageOpportunityRoute["direction"] | null;
  routes: ArbitrageOpportunityRoute[];
  curveSamples: ArbitrageOpportunitySample[];
  readBlock: string;
  quotedAt: number;
};

const BPS = 10_000n;
const MINIMUM_PROFIT_DENOMINATOR = 100_000n;

export function getArbitrageCurveAmounts(maximum: bigint) {
  if (maximum <= 0n) return [];
  if (maximum <= 7n) return Array.from({ length: Number(maximum) }, (_, index) => BigInt(index + 1));

  return [...new Set([
    maximum / 32n,
    maximum / 16n,
    maximum / 8n,
    maximum / 4n,
    maximum / 2n,
    maximum * 3n / 4n,
    maximum,
  ].filter((amount) => amount > 0n).map(String))].map(BigInt);
}

/**
 * Protects a one-click strategy from executing for a dust-sized owner return.
 * The amount remains denominated in the selected Reserve Token and scales with
 * the user's permission instead of assuming a token's decimals or USD price.
 */
export function getArbitrageMinimumProfit(maximum: bigint) {
  if (maximum <= 0n) return 1n;
  const scaled = maximum / MINIMUM_PROFIT_DENOMINATOR;
  return scaled > 0n ? scaled : 1n;
}

export function calculateArbitrageRoute({
  direction,
  amountIn,
  amountOut,
  limit,
  protocolFeeBps,
  executorRewardBps,
}: {
  direction: ArbitrageOpportunityRoute["direction"];
  amountIn: bigint;
  amountOut: bigint;
  limit: bigint;
  protocolFeeBps: number;
  executorRewardBps: number;
}): ArbitrageOpportunityRoute {
  const grossDifference = amountOut >= amountIn ? amountOut - amountIn : -(amountIn - amountOut);
  const ownerDifference = grossDifference <= 0n
    ? grossDifference
    : grossDifference
      - grossDifference * BigInt(protocolFeeBps) / BPS
      - grossDifference * BigInt(executorRewardBps) / BPS;
  const withinLimit = amountIn <= limit;

  const netReturnBps = amountIn > 0n ? Number(ownerDifference * BPS / amountIn) : 0;
  const netPositive = withinLimit && ownerDifference > 0n;

  return {
    direction,
    amountInRaw: amountIn.toString(),
    amountOutRaw: amountOut.toString(),
    grossDifferenceRaw: grossDifference.toString(),
    ownerDifferenceRaw: ownerDifference.toString(),
    netReturnBps,
    withinLimit,
    netPositive,
    gapBps: netReturnBps,
    profitable: netPositive,
  };
}

export function selectBestArbitrageSample(samples: ArbitrageOpportunitySample[]) {
  const candidates = samples.flatMap((sample) => sample.routes.map((route) => ({ sample, route })));
  return candidates.sort((left, right) => {
    const leftProfit = BigInt(left.route.ownerDifferenceRaw);
    const rightProfit = BigInt(right.route.ownerDifferenceRaw);
    if (leftProfit === rightProfit) return 0;
    return leftProfit > rightProfit ? -1 : 1;
  })[0] ?? null;
}

export function getArbitrageExecutor(chain: ChainKey): Address | null {
  if (chain !== "base") return null;
  const value = process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR;
  return value && isAddress(value) ? getAddress(value) : null;
}

export function getArbitrageExecutorV2(chain: ChainKey): Address | null {
  if (chain !== "base") return null;
  const value = process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V2;
  return value && isAddress(value) ? getAddress(value) : null;
}

export function getArbitrageExecutorV3(chain: ChainKey): Address | null {
  if (chain !== "base") return null;
  const value = process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V3;
  return value && isAddress(value) ? getAddress(value) : null;
}

export function getArbitrageDeploymentBlock(chain: ChainKey): bigint | null {
  if (chain !== "base") return null;
  const value = process.env.ARBITRAGE_EXECUTOR_DEPLOYMENT_BLOCK;
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export function getArbitrageDeploymentBlockV2(chain: ChainKey): bigint | null {
  if (chain !== "base") return null;
  const value = process.env.ARBITRAGE_EXECUTOR_V2_DEPLOYMENT_BLOCK;
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export function getArbitrageDeploymentBlockV3(chain: ChainKey): bigint | null {
  if (chain !== "base") return null;
  const value = process.env.ARBITRAGE_EXECUTOR_V3_DEPLOYMENT_BLOCK;
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}
