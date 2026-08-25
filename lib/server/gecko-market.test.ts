import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readTokenMarketPrice } from "./gecko-market";

const TOKEN = "0x0000000000000000000000000000000000000001" as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeckoTerminal price selection", () => {
  it("selects the most liquid attributed pool instead of trusting response order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          attributes: {
            address: "0x0000000000000000000000000000000000000010",
            base_token_price_usd: "2",
            reserve_in_usd: "1000",
          },
          relationships: { base_token: { data: { id: `base_${TOKEN}` } } },
        },
        {
          attributes: {
            address: "0x0000000000000000000000000000000000000020",
            quote_token_price_usd: "1.5",
            reserve_in_usd: "50000",
          },
          relationships: { quote_token: { data: { id: `base_${TOKEN}` } } },
        },
      ],
    }), { status: 200 })));

    const result = await readTokenMarketPrice("base", TOKEN, { fresh: true });

    expect(result).toMatchObject({
      usd: 1.5,
      liquidityUsd: 50_000,
      sourcePool: "0x0000000000000000000000000000000000000020",
    });
  });
});
