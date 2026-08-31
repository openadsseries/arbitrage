import { describe, expect, it } from "vitest";
import {
  ArbitrageRouteUnavailableError,
  isArbitrageContractRevertError,
  isArbitrageInfrastructureError,
  isArbitrageRouteUnavailableError,
} from "./arbitrage-execution-errors";

describe("arbitrage execution error classification", () => {
  it("detects an RPC failure nested in a provider error", () => {
    const error = new Error("Contract call failed", {
      cause: new Error("HTTP request failed with status 429"),
    });
    expect(isArbitrageInfrastructureError(error)).toBe(true);
  });

  it("does not classify a genuine route miss as infrastructure failure", () => {
    const error = new ArbitrageRouteUnavailableError();
    expect(isArbitrageRouteUnavailableError(error)).toBe(true);
    expect(isArbitrageInfrastructureError(error)).toBe(false);
  });

  it("fails closed on network timeouts", () => {
    expect(isArbitrageInfrastructureError(new Error("Request timed out"))).toBe(
      true,
    );
  });

  it("treats archive access denial as infrastructure failure", () => {
    expect(
      isArbitrageInfrastructureError(
        new Error("HTTP error 403: Archive requests require a personal token"),
      ),
    ).toBe(true);
  });

  it("recognizes an onchain revert separately from an RPC failure", () => {
    const error = new Error("The contract function routeExactInput reverted.");
    expect(isArbitrageContractRevertError(error)).toBe(true);
    expect(isArbitrageInfrastructureError(error)).toBe(false);
  });
});
