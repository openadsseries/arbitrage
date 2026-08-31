import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createBaseRpcTransport, parseBaseRpcUrls } from "./base-rpc";

describe("Base RPC configuration", () => {
  it("keeps an ordered, unique endpoint list", () => {
    expect(
      parseBaseRpcUrls(
        "https://primary.example/rpc",
        " https://backup.example/rpc,https://primary.example/rpc ",
      ),
    ).toEqual(["https://primary.example/rpc", "https://backup.example/rpc"]);
  });

  it("accepts public Base endpoints as the operating transport", () => {
    expect(() =>
      createBaseRpcTransport([
        "https://base-rpc.publicnode.com",
        "https://mainnet.base.org",
      ]),
    ).not.toThrow();
  });

  it("uses ordered public fallbacks without environment configuration", () => {
    vi.stubEnv("BASE_RPC_URL", "");
    vi.stubEnv("BASE_RPC_FALLBACK_URLS", "");
    expect(parseBaseRpcUrls()).toEqual([
      "https://base-rpc.publicnode.com",
      "https://base-mainnet.public.blastapi.io",
      "https://mainnet.base.org",
    ]);
    vi.unstubAllEnvs();
  });
});
