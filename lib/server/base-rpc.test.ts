import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertProductionV4Rpc,
  isKnownPublicBaseRpc,
  parseBaseRpcUrls,
} from "./base-rpc";

describe("Base RPC configuration", () => {
  it("keeps an ordered, unique endpoint list", () => {
    expect(
      parseBaseRpcUrls(
        "https://primary.example/rpc",
        " https://backup.example/rpc,https://primary.example/rpc ",
      ),
    ).toEqual(["https://primary.example/rpc", "https://backup.example/rpc"]);
  });

  it("recognizes the known rate-limited public endpoints", () => {
    expect(isKnownPublicBaseRpc("https://mainnet.base.org")).toBe(true);
    expect(isKnownPublicBaseRpc("https://base-rpc.publicnode.com")).toBe(true);
    expect(isKnownPublicBaseRpc("https://rpc.provider.example/key")).toBe(
      false,
    );
  });

  it("blocks V4 production activation without an acknowledged private RPC", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ARBITRAGE_V4_ENABLED", "true");
    vi.stubEnv("ARBITRAGE_RPC_PRODUCTION_READY", "false");

    expect(() => assertProductionV4Rpc(["https://mainnet.base.org"])).toThrow(
      "Authenticated Base RPC required.",
    );

    vi.stubEnv("ARBITRAGE_RPC_PRODUCTION_READY", "true");
    expect(() =>
      assertProductionV4Rpc(["https://rpc.provider.example/key"]),
    ).not.toThrow();
    vi.unstubAllEnvs();
  });
});
