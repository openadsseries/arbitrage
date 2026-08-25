import "server-only";

import type { Address } from "viem";
import type { ChainKey } from "@/lib/chains";

const GECKO_ROOT = "https://api.geckoterminal.com/api/v2";
const GECKO_HEADERS = { accept: "application/json", version: "20230302" };

type OhlcvResponse = {
  data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
};

export type MarketComparisonPoint = { timestamp: number; og: number; hyped: number };
export type MarketComparison = {
  points: MarketComparisonPoint[];
  firstObserved: number;
  lastObserved: number;
};
export type MarketComparisonState =
  | { status: "ready"; data: MarketComparison }
  | { status: "unavailable"; reason: "markets-not-ready" | "price-history-unavailable" | "not-enough-history" };

type ComparisonMarket = { token: Address; pool: string };

async function dailyCloses(chain: ChainKey, market: ComparisonMarket) {
  const tokenAddress = market.token.toLowerCase();
  const query = new URLSearchParams({ aggregate: "1", limit: "90", currency: "usd", token: tokenAddress });
  const response = await fetch(`${GECKO_ROOT}/networks/${chain}/pools/${market.pool}/ohlcv/day?${query}`, {
    headers: GECKO_HEADERS,
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`GeckoTerminal returned ${response.status}.`);
  const ohlcv = await response.json() as OhlcvResponse;
  return (ohlcv.data?.attributes?.ohlcv_list ?? [])
    .flatMap((candle) => Number.isFinite(candle[0]) && Number.isFinite(candle[4]) && candle[4] > 0
      ? [{ timestamp: Math.floor(candle[0] / 86_400) * 86_400, close: candle[4] }]
      : [])
    .sort((left, right) => left.timestamp - right.timestamp);
}

/** Compares only the two pools used by the executable arbitrage route. */
export async function readMarketComparison(input: {
  chain: ChainKey;
  og: ComparisonMarket | null;
  hyped: ComparisonMarket | null;
}): Promise<MarketComparisonState> {
  if (!input.og || !input.hyped) return { status: "unavailable", reason: "markets-not-ready" };
  try {
    const [ogCandles, hypedCandles] = await Promise.all([
      dailyCloses(input.chain, input.og),
      dailyCloses(input.chain, input.hyped),
    ]);
    const hypedByTime = new Map(hypedCandles.map((point) => [point.timestamp, point.close]));
    const common = ogCandles.flatMap((point) => {
      const hyped = hypedByTime.get(point.timestamp);
      return hyped ? [{ timestamp: point.timestamp, og: point.close, hyped }] : [];
    });
    if (common.length < 2) return { status: "unavailable", reason: "not-enough-history" };
    const first = common[0];
    const points = common.map((point) => ({
      timestamp: point.timestamp,
      og: point.og / first.og * 100,
      hyped: point.hyped / first.hyped * 100,
    }));
    return {
      status: "ready",
      data: {
        points,
        firstObserved: points[0].timestamp,
        lastObserved: points.at(-1)?.timestamp ?? points[0].timestamp,
      },
    };
  } catch {
    return { status: "unavailable", reason: "price-history-unavailable" };
  }
}
