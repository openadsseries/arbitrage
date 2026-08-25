import { NextResponse } from "next/server";
import { MARKET_CHAINS, readMarketsSnapshot } from "@/lib/server/market-snapshots";

export const dynamic = "force-dynamic";

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
