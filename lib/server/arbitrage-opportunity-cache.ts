import "server-only";

import { unstable_cache } from "next/cache";
import { getAddress } from "viem";
import {
  readArbitrageBenchmarkOpportunity,
  readArbitrageOpportunity,
} from "@/lib/server/arbitrage-opportunity";
import type { ArbitrageQuoteMode } from "@/lib/arbitrage";
import { isOpportunityQuoteFresh } from "@/lib/arbitrage-freshness";

const OPPORTUNITY_REVALIDATE_SECONDS = 15;

export const MAX_PUBLIC_ARBITRAGE_QUOTE = (1n << 128n) - 1n;

const readPersistedArbitrageOpportunity = unstable_cache(
  async (token: string, amountRaw: string, mode: ArbitrageQuoteMode = "optimize") =>
    readArbitrageOpportunity(getAddress(token), BigInt(amountRaw), { mode }),
  ["arbitrage-opportunity-reserve-v2"],
  { revalidate: OPPORTUNITY_REVALIDATE_SECONDS },
);

const readPersistedArbitrageBenchmarkOpportunity = unstable_cache(
  async (token: string, benchmarkUsd: number) =>
    readArbitrageBenchmarkOpportunity(getAddress(token), benchmarkUsd),
  ["arbitrage-opportunity-benchmark-v1"],
  { revalidate: OPPORTUNITY_REVALIDATE_SECONDS },
);

export async function readCachedArbitrageOpportunity(
  token: string,
  amountRaw: string,
  mode: ArbitrageQuoteMode = "optimize",
) {
  const cached = await readPersistedArbitrageOpportunity(token, amountRaw, mode);
  if (isOpportunityQuoteFresh(cached.quotedAt)) return cached;
  return readArbitrageOpportunity(getAddress(token), BigInt(amountRaw), { mode });
}

export async function readCachedArbitrageBenchmarkOpportunity(
  token: string,
  benchmarkUsd: number,
) {
  const cached = await readPersistedArbitrageBenchmarkOpportunity(token, benchmarkUsd);
  if (isOpportunityQuoteFresh(cached.quotedAt)) return cached;
  return readArbitrageBenchmarkOpportunity(getAddress(token), benchmarkUsd);
}
