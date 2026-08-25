import { describe, expect, it } from "vitest";
import {
  CURVE_PRICE_RATIO,
  TARGET_RESERVE_USD,
  calibrateLaunchCurve,
  calculateCurveBacking,
  calculateBackingFromSteps,
} from "./launch-curve";

const TOKEN = "0x0000000000000000000000000000000000000001" as const;

describe("launch curve calibration", () => {
  it("calibrates the exact Mint Club steps to the $1M reserve target", () => {
    const result = calibrateLaunchCurve({
      reserveToken: { address: TOKEN, decimals: 18 },
      reservePriceUsd: 0.0002202,
      reserveTotalSupply: 10_000_000_000,
    });

    expect(result.configuration.finalMintingPrice / result.configuration.initialMintingPrice)
      .toBeCloseTo(CURVE_PRICE_RATIO, 10);
    expect(Math.abs(result.actualReserveUsd - TARGET_RESERVE_USD) / TARGET_RESERVE_USD).toBeLessThan(0.001);
    expect(result.errorRatio).toBeLessThan(0.001);

    const backing = calculateCurveBacking(result.configuration, { address: TOKEN, decimals: 18 });
    expect(backing.backingRaw).toBe(result.backing.backingRaw);
  });

  it("includes reserve-token decimal rounding in the result", () => {
    const result = calibrateLaunchCurve({
      reserveToken: { address: TOKEN, decimals: 8 },
      reservePriceUsd: 1,
      reserveTotalSupply: 10_000_000,
    });

    expect(result.errorRatio).toBeLessThan(0.001);
    expect(result.backing.stepCount).toBeGreaterThan(1);
  });

  it("includes a zero-priced creator allocation without treating it as reserve", () => {
    const result = calibrateLaunchCurve({
      reserveToken: { address: TOKEN, decimals: 18 },
      reservePriceUsd: 0.25,
      reserveTotalSupply: 100_000_000,
      settings: {
        maxSupply: 1_000_000_000,
        stepCount: 100,
        creatorAllocation: 10_000_000,
        buyRoyalty: 1,
        sellRoyalty: 1,
      },
    });

    expect(result.errorRatio).toBeLessThan(0.001);
  });

  it("rejects malformed Mint Club step arrays", () => {
    expect(() => calculateBackingFromSteps([2n, 1n], [1n, 2n], 18))
      .toThrow("not strictly increasing");
    expect(() => calculateBackingFromSteps([1n, 2n], [1n], 18))
      .toThrow("invalid");
  });

  it("rejects a low-precision curve instead of presenting a false $1M result", () => {
    expect(() => calibrateLaunchCurve({
      reserveToken: { address: TOKEN, decimals: 6 },
      reservePriceUsd: 1,
      reserveTotalSupply: 10_000_000,
    })).toThrow("cannot produce a $1M reserve accurately enough");
  });

  it("rejects tokens without a real USD price", () => {
    expect(() => calibrateLaunchCurve({
      reserveToken: { address: TOKEN, decimals: 18 },
      reservePriceUsd: 0,
      reserveTotalSupply: 10_000_000_000,
    })).toThrow("live USD price");
  });

  it("rejects a target larger than the OG token's entire supply value", () => {
    expect(() => calibrateLaunchCurve({
      reserveToken: { address: TOKEN, decimals: 18 },
      reservePriceUsd: 0.01,
      reserveTotalSupply: 10_000,
    })).toThrow("full supply is worth less");
  });
});
