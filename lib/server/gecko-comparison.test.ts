import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readMarketComparison } from "./gecko-comparison";

const TOKEN_A = "0x0000000000000000000000000000000000000001" as const;
const TOKEN_B = "0x0000000000000000000000000000000000000002" as const;
const DAY = 86_400;

function candle(day: number, close: number): [number, number, number, number, number, number] {
  return [day * DAY, close, close, close, close, 1];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeckoTerminal market comparison", () => {
  it("fills missing calendar days with the previous close", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      const closes = href.includes("/pools/og/")
        ? [candle(100, 10), candle(101, 20), candle(103, 40)]
        : [candle(100, 5), candle(102, 15), candle(103, 25)];
      return new Response(JSON.stringify({
        data: { attributes: { ohlcv_list: closes } },
      }), { status: 200 });
    }));

    const result = await readMarketComparison({
      chain: "base",
      og: { token: TOKEN_A, pool: "og" },
      hyped: { token: TOKEN_B, pool: "hyped" },
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data.points.map((point) => point.timestamp)).toEqual([100, 101, 102, 103].map((day) => day * DAY));
    expect(result.data.points.map((point) => point.og)).toEqual([100, 200, 200, 400]);
    expect(result.data.points.map((point) => point.hyped)).toEqual([100, 100, 300, 500]);
  });

  it("recovers from a temporary GeckoTerminal limit", async () => {
    let ogRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/pools/og/")) {
        ogRequests += 1;
        if (ogRequests === 1) return new Response("limited", { status: 429 });
      }
      return new Response(JSON.stringify({
        data: { attributes: { ohlcv_list: [candle(100, 10), candle(101, 11)] } },
      }), { status: 200 });
    }));

    const result = await readMarketComparison({
      chain: "base",
      og: { token: TOKEN_A, pool: "og" },
      hyped: { token: TOKEN_B, pool: "hyped" },
    });

    expect(result.status).toBe("ready");
    expect(ogRequests).toBe(2);
  });

  it("uses the token's data pool when the execution pool cannot provide history", async () => {
    const fallbackPool = "0x0000000000000000000000000000000000000011";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/pools/og/")) return new Response("missing", { status: 404 });
      if (href.includes(`/tokens/${TOKEN_A}/pools`)) {
        return new Response(JSON.stringify({
          data: [{
            attributes: {
              address: fallbackPool,
              base_token_price_usd: "1",
              reserve_in_usd: "1000",
            },
            relationships: {
              base_token: { data: { id: `base_${TOKEN_A}` } },
            },
          }],
        }), { status: 200 });
      }
      if (href.includes(`/pools/${fallbackPool}/`)) {
        return new Response(JSON.stringify({
          data: { attributes: { ohlcv_list: [candle(100, 10), candle(101, 12)] } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: { attributes: { ohlcv_list: [candle(100, 5), candle(101, 6)] } },
      }), { status: 200 });
    }));

    const result = await readMarketComparison({
      chain: "base",
      og: { token: TOKEN_A, pool: "og" },
      hyped: { token: TOKEN_B, pool: "hyped" },
    });

    expect(result.status).toBe("ready");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/pools/${fallbackPool}/ohlcv/day`),
      expect.any(Object),
    );
  });

  it("keeps a temporary provider failure distinct from missing history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));

    const result = await readMarketComparison({
      chain: "base",
      og: { token: TOKEN_A, pool: "og" },
      hyped: { token: TOKEN_B, pool: "hyped" },
    });

    expect(result).toEqual({ status: "unavailable", reason: "price-history-unavailable" });
  });
});
