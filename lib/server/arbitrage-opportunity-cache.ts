import "server-only";

import { unstable_cache } from "next/cache";
import { getAddress } from "viem";
import { readArbitrageOpportunity } from "@/lib/server/arbitrage-opportunity";

const OPPORTUNITY_REVALIDATE_SECONDS = 15;

export const MAX_PUBLIC_ARBITRAGE_QUOTE = (1n << 128n) - 1n;

export const readCachedArbitrageOpportunity = unstable_cache(
  async (token: string, amountRaw: string) =>
    readArbitrageOpportunity(getAddress(token), BigInt(amountRaw)),
  ["arbitrage-opportunity-reserve-v1"],
  { revalidate: OPPORTUNITY_REVALIDATE_SECONDS },
);
