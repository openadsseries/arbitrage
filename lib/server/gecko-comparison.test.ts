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
});
