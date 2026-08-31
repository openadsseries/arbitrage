import { describe, expect, it } from "vitest";
import { ArbitrageRouteUnavailableError } from "./arbitrage-execution-errors";
import { searchArbitrageDirection } from "./arbitrage-executable-search";

describe("arbitrage direction search", () => {
  it("completes a genuine no-route search without inventing a candidate", async () => {
    const result = await searchArbitrageDirection(10n, async () => {
      throw new ArbitrageRouteUnavailableError();
    });
    expect(result).toEqual({ candidate: null, complete: true });
  });

  it("marks an RPC failure as incomplete instead of no route", async () => {
    const result = await searchArbitrageDirection(10n, async () => {
      throw new Error("RPC request failed: 429 Too Many Requests");
    });
    expect(result).toEqual({ candidate: null, complete: false });
  });

  it("keeps a valid candidate when other sampled amounts have no route", async () => {
    const result = await searchArbitrageDirection(10n, async (amount) => {
      if (amount < 8n) throw new ArbitrageRouteUnavailableError();
      return { amount, net: amount };
    });
    expect(result.complete).toBe(true);
    expect(result.candidate?.amount).toBe(10n);
  });
});
