import {
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
} from "viem";
import { calculateV3ProfitSplit } from "./arbitrage-economics.mjs";
import type { ChainKey } from "@/lib/chains";

// The user chooses a bounded budget; route, executable size and direction are
// selected from live onchain quotes by the executor service.
export const ARBITRAGE_ONE_CLICK_VALIDITY_SECONDS = 24 * 60 * 60;
export const ARBITRAGE_V4_MIN_NET_RETURN_BPS = 10;
export const MARKET_SCAN_DEFAULT_USD = 10;
export const MARKET_SCAN_MIN_USD = 0.01;
export const MARKET_SCAN_MAX_USD = 10_000;

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
  "function weth() view returns (address)",
  "function mintClubBond() view returns (address)",
  "function onchainRouter() view returns (address)",
  "event StrategyStarted(uint256 indexed strategyId,address indexed owner,address indexed hToken,address reserveToken,uint256 maxReservePerExecution,uint256 totalVolume,uint256 minProfitReserve,uint40 validUntil)",
  "event StrategyStopped(uint256 indexed strategyId,address indexed owner)",
  "event ArbitrageExecuted(uint256 indexed strategyId,address indexed owner,address indexed executor,uint8 direction,address reserveToken,uint256 amountInReserve,uint256 amountReturnedReserve,uint256 grossProfitReserve,uint256 protocolFeeReserve,uint256 executorRewardReserve,uint256 ownerProfitReserve,uint256 remainingVolume,uint64 executionCount)",
]);

export const ARBITRAGE_EXECUTOR_V4_ABI = parseAbi([
  "error Reentered()",
  "error ZeroAddress()",
  "error InvalidConfiguration()",
  "error UnknownMintClubToken()",
  "error StrategyAlreadyActive()",
  "error NotStrategyOwner()",
  "error UnauthorizedExecutor()",
  "error UnauthorizedOperatorManager()",
  "error InvalidPendingExecutor()",
  "error ContractPaused()",
  "error StrategyInactive()",
  "error StrategyExpired()",
  "error AmountOutsidePermission()",
  "error AlreadyExecutedThisBlock()",
  "error MinimumProfitNotMet(uint256 actualProfit,uint256 requiredProfit)",
  "error FeeLimitExceeded(uint256 actualFee,uint256 maximumFee)",
  "error FeeClaimExceedsUpperBound(uint256 claimedFee,uint256 maximumFee)",
  "error FeeOracleUnavailable()",
  "error MissingRoute()",
  "error UnsupportedTokenTransfer(address token,uint256 expected,uint256 received)",
  "error TokenCallFailed(address token)",
  "function startStrategy(address hToken,uint256 maxReservePerExecution,uint256 totalVolume,uint256 minProfitReserve,uint16 minProfitBps,uint256 maxFeeReimbursementReserve,uint40 validUntil) returns (uint256 strategyId)",
  "function stopStrategy(uint256 strategyId)",
  "function execute(uint256 strategyId,uint8 direction,(uint256 amountInReserve,uint256 hAmountForMint,uint256 minimumHypedOut,uint256 minimumBondOut,uint256 minimumReserveOut,uint256 feeReimbursementWei) params) returns (uint256 ownerReturnReserve)",
  "function strategies(uint256 strategyId) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint64 executionCount,uint64 lastExecutionBlock,uint256 maxReservePerExecution,uint256 remainingVolume,uint256 minProfitReserve,uint256 maxFeeReimbursementReserve,uint16 minProfitBps)",
  "function activeStrategyId(address owner,address hToken) view returns (uint256)",
  "function protocolFeeBps() view returns (uint16)",
  "function executorProfitShareBps() view returns (uint16)",
  "function weth() view returns (address)",
  "function mintClubBond() view returns (address)",
  "function onchainRouter() view returns (address)",
  "function trustedExecutor() view returns (address)",
  "function operatorManager() view returns (address)",
  "function paused() view returns (bool)",
  "function quoteGasCostInReserve(address reserveToken,uint256 gasCostWei) view returns (uint256)",
  "event StrategyStarted(uint256 indexed strategyId,address indexed owner,address indexed hToken,address reserveToken,uint256 maxReservePerExecution,uint256 totalVolume,uint256 minProfitReserve,uint16 minProfitBps,uint256 maxFeeReimbursementReserve,uint40 validUntil)",
  "event StrategyStopped(uint256 indexed strategyId,address indexed owner)",
  "event ArbitrageExecuted(uint256 indexed strategyId,address indexed owner,address indexed executor,uint8 direction,address reserveToken,uint256 amountInReserve,uint256 amountSpentReserve,uint256 amountReturnedReserve,uint256 grossProfitReserve,uint256 gasReimbursementReserve,uint256 executorIncentiveReserve,uint256 ownerProfitReserve,uint256 remainingVolume,uint64 executionCount)",
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

export type ArbitrageExecutorVersion = "v3" | "v4";

export type ContinuousArbitrageStrategy = {
  chain: "base";
  version: ArbitrageExecutorVersion;
  executor: Address;
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
  minProfitBps: number;
  maxFeeReimbursementReserveRaw: string;
};

export type ContinuousArbitrageExecution = ReserveArbitrageExecution & {
  version: ArbitrageExecutorVersion;
  executorContract: Address;
  amountSpentReserveRaw: string;
  gasReimbursementReserveRaw: string;
  executorIncentiveReserveRaw: string;
  remainingVolumeRaw: string;
  executionCount: string;
};

export type ContinuousArbitrageSnapshot = {
  configured: boolean;
  executor: Address | null;
  legacyExecutor: Address | null;
  writeVersion: "v4" | null;
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

export function selectDisplayedArbitrageRoute(
  active: boolean,
  activeRoute: ArbitrageOpportunityRoute | null,
  previewRoute: ArbitrageOpportunityRoute | null,
) {
  return active ? activeRoute : previewRoute;
}

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
  quoteMode: ArbitrageQuoteMode;
  benchmarkUsd: number | null;
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

export type ArbitrageQuoteMode = "exact" | "optimize";

export function getArbitrageQuoteAmounts(
  maximum: bigint,
  mode: ArbitrageQuoteMode,
) {
  if (maximum <= 0n) return [];
  return mode === "exact" ? [maximum] : getArbitrageCurveAmounts(maximum);
}

export function reserveAmountForUsdBenchmark(input: {
  benchmarkUsd: number;
  reserveUsd: number;
  reserveDecimals: number;
}) {
  if (!Number.isFinite(input.benchmarkUsd) || input.benchmarkUsd <= 0) {
    throw new Error("Enter a valid USD benchmark.");
  }
  if (!Number.isFinite(input.reserveUsd) || input.reserveUsd <= 0) {
    throw new Error("Reserve Token USD price is unavailable.");
  }
  const precision = Math.min(input.reserveDecimals, 12);
  const reserveUnits = input.benchmarkUsd / input.reserveUsd;
  if (!Number.isFinite(reserveUnits) || reserveUnits <= 0) {
    throw new Error("Reserve Token USD price is unavailable.");
  }
  const amount = parseUnits(
    reserveUnits.toFixed(precision),
    input.reserveDecimals,
  );
  if (amount <= 0n)
    throw new Error("The USD benchmark is too small for this token.");
  return amount;
}

export type PublicArbitrageAssessment =
  | {
      stage: "estimated-return";
      maxBudgetRaw: string;
      bestAmountRaw: string;
      /** Kept for already-open tabs before max-budget naming. */
      quoteAmountRaw: string;
      quoteMode: ArbitrageQuoteMode;
      benchmarkUsd: number | null;
      direction: ArbitrageOpportunityRoute["direction"];
      gapBps: number;
      ownerDifferenceRaw: string;
      verification: "estimated";
      readBlock: string;
      quotedAt: number;
    }
  | {
      stage: "no-route";
      maxBudgetRaw: string;
      /** Kept for already-open tabs before max-budget naming. */
      quoteAmountRaw: string;
      quoteMode: ArbitrageQuoteMode;
      benchmarkUsd: number | null;
      gapBps: 0;
      verification: "estimated";
      readBlock: string;
      quotedAt: number;
    };

export function selectBestOpportunityRoute(
  opportunity: ArbitrageOpportunity | null | undefined,
) {
  if (!opportunity) return null;
  return (
    [...opportunity.routes].sort((left, right) => {
      const leftProfit = BigInt(left.ownerDifferenceRaw);
      const rightProfit = BigInt(right.ownerDifferenceRaw);
      if (leftProfit === rightProfit) return 0;
      return leftProfit > rightProfit ? -1 : 1;
    })[0] ?? null
  );
}

export function assessPublicArbitrageOpportunity(
  opportunity: ArbitrageOpportunity,
): PublicArbitrageAssessment {
  const route = selectBestOpportunityRoute(opportunity);
  if (!route || !route.netPositive) {
    return {
      stage: "no-route",
      maxBudgetRaw: opportunity.checkedAmountRaw,
      quoteAmountRaw: opportunity.checkedAmountRaw,
      quoteMode: opportunity.quoteMode,
      benchmarkUsd: opportunity.benchmarkUsd,
      gapBps: 0,
      verification: "estimated",
      readBlock: opportunity.readBlock,
      quotedAt: opportunity.quotedAt,
    };
  }
  return {
    stage: "estimated-return",
    maxBudgetRaw: opportunity.checkedAmountRaw,
    bestAmountRaw: route.amountInRaw,
    quoteAmountRaw: opportunity.checkedAmountRaw,
    quoteMode: opportunity.quoteMode,
    benchmarkUsd: opportunity.benchmarkUsd,
    direction: route.direction,
    gapBps: route.netReturnBps,
    ownerDifferenceRaw: route.ownerDifferenceRaw,
    verification: "estimated",
    readBlock: opportunity.readBlock,
    quotedAt: opportunity.quotedAt,
  };
}

export type DirectArbitrageExecutionQuote = {
  version: ArbitrageExecutorVersion;
  executor: Address;
  strategyId: string;
  direction: 0 | 1;
  params: {
    amountInReserve: string;
    hAmountForMint: string;
    minimumWethOut: string;
    minimumHypedOut: string;
    minimumBondOut: string;
    minimumReserveOut: string;
    feeReimbursementWei?: string;
  };
  amountInReserveRaw: string;
  expectedReturnRaw: string;
  expectedOwnerProfitRaw: string;
  expectedExecutorRewardRaw: string;
  expectedWalletProfitRaw: string;
  simulatedOwnerReturnRaw: string;
  gasRaw: string;
  gasPriceRaw: string;
  totalFeeWethRaw: string;
  rewardWethRaw: string;
  requiredWethRaw: string;
  reserveUsd?: number | null;
  wethUsd?: number | null;
};

export type ArbitrageExecutionReasonCode =
  | "ready"
  | "fees-higher-than-profit"
  | "no-profitable-route"
  | "quote-unavailable"
  | "not-configured"
  | "not-owner"
  | "inactive"
  | "expired"
  | "no-permission";

const BPS = 10_000n;
const MINIMUM_PROFIT_DENOMINATOR = 100_000n;

export function getArbitrageCurveAmounts(maximum: bigint) {
  if (maximum <= 0n) return [];
  if (maximum <= 7n)
    return Array.from({ length: Number(maximum) }, (_, index) =>
      BigInt(index + 1),
    );

  return [
    ...new Set(
      [
        maximum / 32n,
        maximum / 16n,
        maximum / 8n,
        maximum / 4n,
        maximum / 2n,
        (maximum * 3n) / 4n,
        maximum,
      ]
        .filter((amount) => amount > 0n)
        .map(String),
    ),
  ].map(BigInt);
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

export function getArbitrageMaxFeeReimbursement(maximum: bigint) {
  if (maximum <= 0n) return 1n;
  const cap = maximum / 20n;
  return cap > 0n ? cap : 1n;
}

export function getArbitrageRepeatLimit(
  perRun: bigint,
  available: bigint,
  repeatCount = 10n,
) {
  if (perRun <= 0n || available <= 0n || repeatCount <= 0n) return 0n;
  const repeated = perRun * repeatCount;
  return available < repeated ? available : repeated;
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
  const grossDifference =
    amountOut >= amountIn ? amountOut - amountIn : -(amountIn - amountOut);
  const ownerDifference = calculateV3ProfitSplit(
    grossDifference,
    protocolFeeBps,
    executorRewardBps,
  ).ownerProfit;
  const withinLimit = amountIn <= limit;

  const netReturnBps =
    amountIn > 0n ? Number((ownerDifference * BPS) / amountIn) : 0;
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

export function selectBestArbitrageSample(
  samples: ArbitrageOpportunitySample[],
) {
  const candidates = samples.flatMap((sample) =>
    sample.routes.map((route) => ({ sample, route })),
  );
  return (
    candidates.sort((left, right) => {
      const leftProfit = BigInt(left.route.ownerDifferenceRaw);
      const rightProfit = BigInt(right.route.ownerDifferenceRaw);
      if (leftProfit === rightProfit) return 0;
      return leftProfit > rightProfit ? -1 : 1;
    })[0] ?? null
  );
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

export function getArbitrageExecutorV4(chain: ChainKey): Address | null {
  if (chain !== "base") return null;
  const value = process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4;
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

export function getArbitrageDeploymentBlockV4(chain: ChainKey): bigint | null {
  if (chain !== "base") return null;
  const value = process.env.ARBITRAGE_EXECUTOR_V4_DEPLOYMENT_BLOCK;
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}
