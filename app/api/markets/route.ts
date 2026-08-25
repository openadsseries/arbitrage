import { NextResponse } from "next/server";
import type { ChainKey } from "@/lib/chains";
import { readVerifiedMarkets } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const chains: ChainKey[] = ["base", "robinhood"];
    const results = await Promise.allSettled(chains.map((chain) => readVerifiedMarkets(chain)));
    const markets = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const unavailableChains = chains.filter((_, index) => results[index].status === "rejected");
    if (markets.length === 0 && unavailableChains.length === chains.length) throw new Error("Supported networks are unavailable.");
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
