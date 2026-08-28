import "server-only";

import { unstable_cache } from "next/cache";
import { getAddress } from "viem";
import {
  readArbitrageBenchmarkOpportunity,
  readArbitrageOpportunity,
} from "@/lib/server/arbitrage-opportunity";
import type { ArbitrageQuoteMode } from "@/lib/arbitrage";

const OPPORTUNITY_REVALIDATE_SECONDS = 15;

export const MAX_PUBLIC_ARBITRAGE_QUOTE = (1n << 128n) - 1n;

export const readCachedArbitrageOpportunity = unstable_cache(
  async (token: string, amountRaw: string, mode: ArbitrageQuoteMode = "exact") =>
    readArbitrageOpportunity(getAddress(token), BigInt(amountRaw), { mode }),
  ["arbitrage-opportunity-reserve-v2"],
  { revalidate: OPPORTUNITY_REVALIDATE_SECONDS },
);

export const readCachedArbitrageBenchmarkOpportunity = unstable_cache(
  async (token: string, benchmarkUsd: number) =>
    readArbitrageBenchmarkOpportunity(getAddress(token), benchmarkUsd),
  ["arbitrage-opportunity-benchmark-v1"],
  { revalidate: OPPORTUNITY_REVALIDATE_SECONDS },
);
