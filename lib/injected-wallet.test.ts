import { describe, expect, it, vi } from "vitest";
import { injectedProviderFrom, injectedWalletError } from "./injected-wallet";

describe("injectedProviderFrom", () => {
  it("returns only a valid injected EIP-1193 provider", () => {
    const provider = { request: vi.fn() };
    expect(injectedProviderFrom({ ethereum: provider })).toBe(provider);
    expect(injectedProviderFrom({ ethereum: {} })).toBeNull();
    expect(injectedProviderFrom(null)).toBeNull();
  });

  it("detects OKX injected wallet providers", () => {
    const okx = { request: vi.fn(), isOkxWallet: true };
    const okxLegacy = { request: vi.fn(), isOKExWallet: true };
    const fallback = { request: vi.fn() };
    const aggregate = { request: vi.fn(), providers: [fallback, okx] };
    expect(injectedProviderFrom({ ethereum: aggregate })).toBe(okx);
    expect(injectedProviderFrom({ ethereum: { providers: [fallback, okx] } })).toBe(okx);
    expect(injectedProviderFrom({ ethereum: { providers: [fallback, okxLegacy] } })).toBe(okxLegacy);
    expect(injectedProviderFrom({ okxwallet: okx })).toBe(okx);
    expect(injectedProviderFrom({ okxwallet: { ethereum: okx } })).toBe(okx);
  });
});

describe("injectedWalletError", () => {
  it("turns wallet errors into short user messages", () => {
    expect(injectedWalletError({ code: 4001 })).toBe("Connection cancelled in wallet.");
    expect(injectedWalletError({ cause: { code: -32002 } })).toBe("Open your wallet to finish connecting.");
    expect(injectedWalletError({ code: 4100 })).toBe("Allow this site in your wallet, then try again.");
    expect(injectedWalletError(new Error("internal provider details"))).toBe("Wallet connection failed. Try again.");
  });
});
