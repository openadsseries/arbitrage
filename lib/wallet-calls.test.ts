import { describe, expect, it } from "vitest";
import { isAtomicCallsUnsupported, sendAtomicCallsIfSupported, supportsAtomicCalls } from "./wallet-calls";

describe("supportsAtomicCalls", () => {
  it("accepts supported and wallet-upgrade-ready atomic batches", () => {
    expect(supportsAtomicCalls({ atomic: { status: "supported" } })).toBe(true);
    expect(supportsAtomicCalls({ atomic: { status: "ready" } })).toBe(true);
  });

  it("rejects missing or unsupported atomic batches", () => {
    expect(supportsAtomicCalls({ atomic: { status: "unsupported" } })).toBe(false);
    expect(supportsAtomicCalls({})).toBe(false);
    expect(supportsAtomicCalls(null)).toBe(false);
  });
});

describe("isAtomicCallsUnsupported", () => {
  it("recognizes method and atomicity support errors", () => {
    expect(isAtomicCallsUnsupported({ code: -32601 })).toBe(true);
    expect(isAtomicCallsUnsupported({ code: 5760 })).toBe(true);
    expect(isAtomicCallsUnsupported({ name: "AtomicityNotSupportedError" })).toBe(true);
    expect(isAtomicCallsUnsupported({ cause: { message: "wallet_sendCalls is not supported" } })).toBe(true);
  });

  it("never treats a user rejection as an unsupported wallet", () => {
    expect(isAtomicCallsUnsupported({ code: 4001, message: "User rejected the request" })).toBe(false);
    expect(isAtomicCallsUnsupported({ code: 5750, message: "Atomic-ready wallet rejected upgrade" })).toBe(false);
  });
});

describe("sendAtomicCallsIfSupported", () => {
  it("submits and waits for one supported atomic batch", async () => {
    const sent: string[] = [];
    const result = await sendAtomicCallsIfSupported({
      getCapabilities: async () => ({ atomic: { status: "supported" } }),
      sendCalls: async () => { sent.push("sent"); return { id: "batch-1" }; },
      waitForCallsStatus: async (id) => { sent.push(id); return { status: "success" }; },
    });
    expect(result).toBe(true);
    expect(sent).toEqual(["sent", "batch-1"]);
  });

  it("falls back only before a batch is accepted", async () => {
    let sent = false;
    const missingCapability = await sendAtomicCallsIfSupported({
      getCapabilities: async () => { throw new Error("Method not found"); },
      sendCalls: async () => { sent = true; return { id: "never" }; },
      waitForCallsStatus: async () => ({ status: "success" }),
    });
    expect(missingCapability).toBe(false);
    expect(sent).toBe(false);

    const unsupportedSend = await sendAtomicCallsIfSupported({
      getCapabilities: async () => ({ atomic: { status: "supported" } }),
      sendCalls: async () => { throw { code: 5760 }; },
      waitForCallsStatus: async () => ({ status: "success" }),
    });
    expect(unsupportedSend).toBe(false);
  });

  it("does not fall back after user rejection or an accepted batch", async () => {
    await expect(sendAtomicCallsIfSupported({
      getCapabilities: async () => ({ atomic: { status: "ready" } }),
      sendCalls: async () => { throw { code: 4001, message: "User rejected" }; },
      waitForCallsStatus: async () => ({ status: "success" }),
    })).rejects.toMatchObject({ code: 4001 });

    await expect(sendAtomicCallsIfSupported({
      getCapabilities: async () => ({ atomic: { status: "supported" } }),
      sendCalls: async () => ({ id: "accepted" }),
      waitForCallsStatus: async () => ({ status: "failure" }),
    })).rejects.toThrow("The wallet batch did not confirm.");
  });
});
