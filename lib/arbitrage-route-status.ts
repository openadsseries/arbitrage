import {
  selectBestOpportunityRoute,
  type ArbitrageMarketReadiness,
  type ArbitrageOpportunity,
  type DirectArbitrageExecutionQuote,
} from "./arbitrage";

export type ArbitrageRouteCheck = {
  key: "reserve" | "pool" | "costs" | "automation";
  label: string;
  value: string;
  tone: "ready" | "waiting" | "blocked";
  detail: string;
};

function includesReason(reason: string, values: string[]) {
  return values.some((value) => reason.includes(value));
}

export function buildArbitrageRouteChecks({
  readiness,
  opportunity,
  reserveBalanceRaw,
  active,
  reason,
  quote,
}: {
  readiness: ArbitrageMarketReadiness | null;
  opportunity: ArbitrageOpportunity | null;
  reserveBalanceRaw: string;
  active: boolean;
  reason: string;
  quote: DirectArbitrageExecutionQuote | null;
}): ArbitrageRouteCheck[] {
  const reserveReady = BigInt(reserveBalanceRaw || "0") > 0n;
  const poolReady = Boolean(
    readiness?.hypedMarket.ready &&
      readiness.hypedMarket.executorCompatible,
  );
  const route = selectBestOpportunityRoute(opportunity);
  const routePositive = Boolean(
    route?.netPositive && BigInt(route.ownerDifferenceRaw) > 0n,
  );
  const gasWaiting = includesReason(reason, ["Fees are higher than profit", "Gas too high", "Waiting for gas"]);
  const routeWaiting = includesReason(reason, ["No profitable route", "No route", "Not executable"]);
  const networkWaiting = includesReason(reason, [
    "Base is busy",
    "Price check unavailable",
    "Base read failed",
  ]);
  const setupBlocked = includesReason(reason, [
    "Relay setup needed",
    "Relay not configured",
    "Relay needs Base ETH",
  ]);
  const quoteCoversGas = Boolean(
    quote &&
      (quote.version === "v4"
        ? BigInt(quote.expectedOwnerProfitRaw) > 0n
        : BigInt(quote.rewardWethRaw) >= BigInt(quote.requiredWethRaw)),
  );

  const costs: ArbitrageRouteCheck = networkWaiting
    ? {
        key: "costs",
        label: "Costs",
        value: "Check unavailable",
        tone: "waiting",
        detail: "The latest price and fee check did not complete. It will retry.",
      }
    : gasWaiting
    ? {
        key: "costs",
        label: "Costs",
        value: "Fees too high",
        tone: "waiting",
        detail: "The estimated fees are higher than the current profit.",
      }
    : quoteCoversGas
      ? {
          key: "costs",
          label: "Costs",
          value: "Covered",
          tone: "ready",
          detail: "Fees, price impact, reward, and gas are covered.",
        }
      : routePositive
        ? {
            key: "costs",
            label: "Costs",
            value: "Checking gas",
            tone: "waiting",
            detail: "Fees and price impact are covered. Gas is checked before execution.",
          }
        : {
            key: "costs",
            label: "Costs",
            value: opportunity || routeWaiting ? "Waiting" : "Checking",
            tone: "waiting",
            detail: "Execution waits until the return is higher than every cost.",
          };

  const automation: ArbitrageRouteCheck = setupBlocked
    ? {
        key: "automation",
        label: "Automation",
        value: "Setup needed",
        tone: "blocked",
        detail: "Automatic execution cannot run until the relay is ready.",
      }
    : active
      ? {
          key: "automation",
          label: "Automation",
          value: networkWaiting ? "Retrying" : "On",
          tone: "ready",
          detail:
            "It keeps checking both directions and runs again when every check passes.",
        }
      : {
          key: "automation",
          label: "Automation",
          value: readiness?.ready ? "Ready" : "Unavailable",
          tone: readiness?.ready ? "ready" : "blocked",
          detail: readiness?.ready
            ? "Start once to keep checking both directions."
            : "Both markets and the executor must be ready first.",
        };

  return [
    reserveReady
      ? {
          key: "reserve",
          label: "Mint Club",
          value: "Backed",
          tone: "ready",
          detail: "Mint Club has Reserve available for conversion.",
        }
      : {
          key: "reserve",
          label: "Mint Club",
          value: "No Reserve",
          tone: "blocked",
          detail: "Conversion cannot settle without Reserve.",
        },
    poolReady
      ? {
          key: "pool",
          label: "External pool",
          value: "Live",
          tone: "ready",
          detail: "The Hyped Token pool has executable liquidity.",
        }
      : {
          key: "pool",
          label: "External pool",
          value: "No liquidity",
          tone: "blocked",
          detail: "Execution pauses until external liquidity is available.",
        },
    costs,
    automation,
  ];
}
