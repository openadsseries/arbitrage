import { describe, expect, it } from "vitest";
import { maximizeExecutable } from "../lib/arbitrage-optimizer.mjs";

describe("bounded arbitrage amount search", () => {
  it("finds a profitable interior size instead of defaulting to the cap", async () => {
    const optimum = 370n;
    const result = await maximizeExecutable(1_000n, async (amount) => {
      const distance = amount > optimum ? amount - optimum : optimum - amount;
      const net = 100_000n - distance * distance;
      return net > 0n ? { amount, net } : null;
    });
    expect(result).not.toBeNull();
    expect(result.amount).toBeGreaterThanOrEqual(340n);
    expect(result.amount).toBeLessThanOrEqual(400n);
  });

  it("crosses a losing sample range to find a narrow profitable band", async () => {
    const optimum = 400n;
    const result = await maximizeExecutable(1_000n, async (amount) => {
      const distance = amount > optimum ? amount - optimum : optimum - amount;
      return { amount, net: 8n - distance };
    });

    expect(result).not.toBeNull();
    expect(result.net).toBeGreaterThan(0n);
    expect(result.amount).toBeGreaterThanOrEqual(392n);
    expect(result.amount).toBeLessThanOrEqual(408n);
  });

  it("checks small permissions and ignores failed quotes", async () => {
    const visited = [];
    const result = await maximizeExecutable(9n, async (amount) => {
      visited.push(amount);
      if (amount > 4n) throw new Error("not executable");
      return { amount, net: amount };
    });
    expect(result?.amount).toBe(4n);
    expect(visited.some((amount) => amount <= 2n)).toBe(true);
  });

  it("returns null when no executable size is profitable", async () => {
    const result = await maximizeExecutable(100n, async () => null);
    expect(result).toBeNull();
  });
});
