import "server-only";

import type { Address } from "viem";
import type { ChainKey } from "@/lib/chains";
import { readTokenMarketPrice } from "./gecko-market";

const GECKO_ROOT = "https://api.geckoterminal.com/api/v2";
const GECKO_HEADERS = { accept: "application/json", version: "20230302" };
const DAY_SECONDS = 86_400;

type OhlcvResponse = {
  data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
};

export type MarketComparisonPoint = { timestamp: number; og: number; hyped: number; ogUsd: number; hypedUsd: number };
export type MarketComparison = {
  points: MarketComparisonPoint[];
  firstObserved: number;
  lastObserved: number;
};
export type MarketComparisonState =
  | { status: "ready"; data: MarketComparison }
  | { status: "unavailable"; reason: "markets-not-ready" | "price-history-unavailable" | "not-enough-history" };

type ComparisonMarket = { token: Address; pool: string };

type DailyClose = { timestamp: number; close: number };

function parseDailyCloses(payload: OhlcvResponse): DailyClose[] {
  return (payload.data?.attributes?.ohlcv_list ?? [])
    .flatMap((candle) => Number.isFinite(candle[0]) && Number.isFinite(candle[4]) && candle[4] > 0
      ? [{ timestamp: Math.floor(candle[0] / DAY_SECONDS) * DAY_SECONDS, close: candle[4] }]
      : [])
    .sort((left, right) => left.timestamp - right.timestamp);
}

async function closesFromPool(chain: ChainKey, token: Address, pool: string) {
  const tokenAddress = token.toLowerCase();
  const query = new URLSearchParams({ aggregate: "1", limit: "90", currency: "usd", token: tokenAddress });
  const url = `${GECKO_ROOT}/networks/${chain}/pools/${pool}/ohlcv/day?${query}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      headers: GECKO_HEADERS,
      next: { revalidate: 86_400 },
    });
    if (response.ok) return parseDailyCloses(await response.json() as OhlcvResponse);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 1) throw new Error(`GeckoTerminal returned ${response.status}.`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return [];
}

async function dailyCloses(chain: ChainKey, market: ComparisonMarket) {
  try {
    const routeCloses = await closesFromPool(chain, market.token, market.pool);
    if (routeCloses.length > 0) return routeCloses;
  } catch {
    // Execution pool identifiers and GeckoTerminal pool identifiers can differ.
  }

  const fallback = await readTokenMarketPrice(chain, market.token);
  if (!fallback || fallback.sourcePool.toLowerCase() === market.pool.toLowerCase()) {
    throw new Error("Price history is temporarily unavailable.");
  }
  const fallbackCloses = await closesFromPool(chain, market.token, fallback.sourcePool);
  if (fallbackCloses.length === 0) throw new Error("Price history is temporarily unavailable.");
  return fallbackCloses;
}

function fillDailyComparison(
  ogCandles: Array<{ timestamp: number; close: number }>,
  hypedCandles: Array<{ timestamp: number; close: number }>,
) {
  if (ogCandles.length === 0 || hypedCandles.length === 0) return [];
  const firstDay = Math.min(ogCandles[0].timestamp, hypedCandles[0].timestamp);
  const startDay = Math.max(ogCandles[0].timestamp, hypedCandles[0].timestamp);
  const endDay = Math.min(
    ogCandles.at(-1)?.timestamp ?? firstDay,
    hypedCandles.at(-1)?.timestamp ?? firstDay,
  );
  const points: Array<{ timestamp: number; og: number; hyped: number }> = [];
  let ogIndex = 0;
  let hypedIndex = 0;
  let lastOg: number | null = null;
  let lastHyped: number | null = null;

  for (let timestamp = firstDay; timestamp <= endDay; timestamp += DAY_SECONDS) {
    while (ogIndex < ogCandles.length && ogCandles[ogIndex].timestamp <= timestamp) {
      lastOg = ogCandles[ogIndex].close;
      ogIndex += 1;
    }
    while (hypedIndex < hypedCandles.length && hypedCandles[hypedIndex].timestamp <= timestamp) {
      lastHyped = hypedCandles[hypedIndex].close;
      hypedIndex += 1;
    }
    if (timestamp >= startDay && lastOg !== null && lastHyped !== null) {
      points.push({ timestamp, og: lastOg, hyped: lastHyped });
    }
  }

  return points;
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
    const common = fillDailyComparison(ogCandles, hypedCandles);
    if (common.length < 2) return { status: "unavailable", reason: "not-enough-history" };
    const first = common[0];
    const points = common.map((point) => ({
      timestamp: point.timestamp,
      og: point.og / first.og * 100,
      hyped: point.hyped / first.hyped * 100,
      ogUsd: point.og,
      hypedUsd: point.hyped,
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
