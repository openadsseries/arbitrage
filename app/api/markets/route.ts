import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import type { ChainKey } from "@/lib/chains";
import { readVerifiedMarkets } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

const MARKET_CHAINS: ChainKey[] = ["base", "robinhood"];

const readMarketsSnapshot = unstable_cache(
  async () => {
    const results = await Promise.allSettled(MARKET_CHAINS.map((chain) => readVerifiedMarkets(chain)));
    const markets = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const unavailableChains = MARKET_CHAINS.filter((_, index) => results[index].status === "rejected");
    return { markets, unavailableChains };
  },
  ["markets-snapshot-v1"],
  { revalidate: 30 },
);

export async function GET() {
  try {
    const { markets, unavailableChains } = await readMarketsSnapshot();
    if (markets.length === 0 && unavailableChains.length === MARKET_CHAINS.length) throw new Error("Supported networks are unavailable.");
    return NextResponse.json(
      { markets, unavailableChains, source: "Mint Club and Uniswap contracts" },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read markets." },
      { status: 502 },
    );
  }
}
