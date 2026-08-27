import { describe, expect, it } from "vitest";
import {
  assessPublicArbitrageOpportunity,
  calculateArbitrageRoute,
  getArbitrageCurveAmounts,
  getArbitrageMinimumProfit,
  getArbitrageRepeatLimit,
  selectBestArbitrageSample,
  selectDisplayedArbitrageRoute,
} from "./arbitrage";

describe("arbitrage opportunity math", () => {
  it("reports the user's net only after protocol and executor shares", () => {
    const route = calculateArbitrageRoute({
      direction: "Mint then sell",
      amountIn: 100_000n,
      amountOut: 101_000n,
      limit: 100_000n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });

    expect(route.grossDifferenceRaw).toBe("1000");
    expect(route.ownerDifferenceRaw).toBe("800");
    expect(route.netReturnBps).toBe(80);
    expect(route.netPositive).toBe(true);
    expect(route.gapBps).toBe(80);
    expect(route.profitable).toBe(true);
  });

  it("never presents a losing or over-limit quote as an opportunity", () => {
    const losing = calculateArbitrageRoute({
      direction: "Buy then redeem",
      amountIn: 100_000n,
      amountOut: 99_900n,
      limit: 100_000n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });
    const overLimit = calculateArbitrageRoute({
      direction: "Mint then sell",
      amountIn: 100_001n,
      amountOut: 101_001n,
      limit: 100_000n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });

    expect(losing.netReturnBps).toBe(-10);
    expect(losing.netPositive).toBe(false);
    expect(overLimit.netPositive).toBe(false);
  });

  it("builds a small bounded set of quote sizes ending at the user's budget", () => {
    expect(getArbitrageCurveAmounts(100n)).toEqual([
      3n,
      6n,
      12n,
      25n,
      50n,
      75n,
      100n,
    ]);
    expect(getArbitrageCurveAmounts(3n)).toEqual([1n, 2n, 3n]);
    expect(getArbitrageCurveAmounts(0n)).toEqual([]);
  });

  it("scales the protected owner return with the Reserve Token budget", () => {
    expect(getArbitrageMinimumProfit(1n)).toBe(1n);
    expect(getArbitrageMinimumProfit(99_999n)).toBe(1n);
    expect(getArbitrageMinimumProfit(1_000_000n)).toBe(10n);
  });

  it("sets ten runs and caps them at the wallet balance", () => {
    expect(getArbitrageRepeatLimit(10n, 500n)).toBe(100n);
    expect(getArbitrageRepeatLimit(10n, 73n)).toBe(73n);
    expect(getArbitrageRepeatLimit(0n, 100n)).toBe(0n);
  });

  it("keeps a smaller profitable size when the full budget loses to price impact", () => {
    const profitable = calculateArbitrageRoute({
      direction: "Mint then sell",
      amountIn: 25n,
      amountOut: 30n,
      limit: 100n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });
    const fullBudgetLoss = calculateArbitrageRoute({
      direction: "Mint then sell",
      amountIn: 100n,
      amountOut: 90n,
      limit: 100n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });

    const best = selectBestArbitrageSample([
      { budgetRaw: "25", hAmountRaw: "10", routes: [profitable] },
      { budgetRaw: "100", hAmountRaw: "40", routes: [fullBudgetLoss] },
    ]);

    expect(best?.sample.budgetRaw).toBe("25");
    expect(best?.route.netPositive).toBe(true);
  });

  it("never falls back to a pre-gas market quote for active automation", () => {
    const preview = calculateArbitrageRoute({
      direction: "Mint then sell",
      amountIn: 100n,
      amountOut: 110n,
      limit: 100n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });
    const active = calculateArbitrageRoute({
      direction: "Buy then redeem",
      amountIn: 1_000n,
      amountOut: 1_050n,
      limit: 1_000n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });

    expect(selectDisplayedArbitrageRoute(true, active, preview)).toBe(active);
    expect(selectDisplayedArbitrageRoute(true, null, preview)).toBeNull();
    expect(selectDisplayedArbitrageRoute(false, null, preview)).toBe(preview);
  });

  it("classifies a large pre-gas return as a price gap, not execution readiness", () => {
    const route = calculateArbitrageRoute({
      direction: "Mint then sell",
      amountIn: 100_000_000n,
      amountOut: 224_157_152n,
      limit: 100_000_000n,
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
    });
    const assessment = assessPublicArbitrageOpportunity({
      chain: "base",
      hToken: "0x0000000000000000000000000000000000000001",
      hSymbol: "hBNKR",
      reserveToken: "0x0000000000000000000000000000000000000002",
      reserveSymbol: "BNKR",
      reserveDecimals: 8,
      checkedAmountRaw: "100000000",
      hAmountRaw: "647604546",
      protocolFeeBps: 0,
      executorRewardBps: 2_000,
      priceBasis: {
        reserveUsd: null,
        mintClubUsd: null,
        poolUsd: null,
        hAmountRaw: null,
      },
      bestDirection: route.direction,
      routes: [route],
      curveSamples: [],
      readBlock: "1",
      quotedAt: 1,
    });

    expect(assessment.stage).toBe("price-gap");
    expect(assessment.gapBps).toBe(9_932);
    expect(assessment.gasChecked).toBe(false);
    expect(assessment).not.toHaveProperty("ready");
    expect(assessment).not.toHaveProperty("positive");
  });
});
