import { describe, expect, it } from "vitest";
import { buildArbitrageRouteChecks } from "./arbitrage-route-status";
import type { ArbitrageMarketReadiness, ArbitrageOpportunity } from "./arbitrage";

const readiness = {
  ready: true,
  hypedMarket: {
    ready: true,
    executorCompatible: true,
    liquidityRaw: "1",
  },
} as ArbitrageMarketReadiness;

const opportunity = {
  routes: [
    {
      netPositive: true,
      ownerDifferenceRaw: "10",
    },
  ],
} as ArbitrageOpportunity;

describe("buildArbitrageRouteChecks", () => {
  it("keeps automation active while gas is too high", () => {
    const checks = buildArbitrageRouteChecks({
      readiness,
      opportunity,
      reserveBalanceRaw: "100",
      active: true,
      reason: "Gas too high.",
      quote: null,
    });

    expect(checks.map((check) => check.value)).toEqual([
      "Backed",
      "Live",
      "Gas high",
      "On",
    ]);
  });

  it("blocks a market without an executable external pool", () => {
    const checks = buildArbitrageRouteChecks({
      readiness: {
        ...readiness,
        hypedMarket: {
          ...readiness.hypedMarket,
          executorCompatible: false,
          ready: false,
        },
      },
      opportunity: null,
      reserveBalanceRaw: "100",
      active: false,
      reason: "",
      quote: null,
    });

    expect(checks[1]).toMatchObject({ value: "No liquidity", tone: "blocked" });
  });

  it("trusts executable pool readiness when raw liquidity is not comparable", () => {
    const checks = buildArbitrageRouteChecks({
      readiness: {
        ...readiness,
        hypedMarket: {
          ...readiness.hypedMarket,
          liquidityRaw: "0",
        },
      },
      opportunity,
      reserveBalanceRaw: "100",
      active: false,
      reason: "",
      quote: null,
    });

    expect(checks[1]).toMatchObject({ value: "Live", tone: "ready" });
  });
});
