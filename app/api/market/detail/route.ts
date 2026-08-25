import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { ChainKey } from "@/lib/chains";
import { readArbitrageMarketReadiness } from "@/lib/server/arbitrage";
import { readMarketComparison } from "@/lib/server/gecko-comparison";
import { readVerifiedMarket } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  chain: z.enum(["base", "robinhood"]),
  address: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
});

const readCachedMarketDetail = unstable_cache(
  async (chain: ChainKey, inputAddress: string) => {
    const address = getAddress(inputAddress);
    const market = await readVerifiedMarket(chain, address);
    if (!market) return null;
    const arbitrageReadiness = chain === "base"
      ? await readArbitrageMarketReadiness(chain, market.token).catch(() => null)
      : null;
    const marketComparison = arbitrageReadiness
      ? await readMarketComparison({
        chain,
        og: arbitrageReadiness.originalMarket.pool
          ? { token: market.reserveToken, pool: arbitrageReadiness.originalMarket.pool }
          : null,
        hyped: arbitrageReadiness.hypedMarket.pool
          ? { token: market.token, pool: arbitrageReadiness.hypedMarket.pool }
          : null,
      })
      : { status: "unavailable" as const, reason: "markets-not-ready" as const };
    return { market, arbitrageReadiness, marketComparison };
  },
  ["market-detail-v1"],
  { revalidate: 15 },
);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      chain: url.searchParams.get("chain"),
      address: url.searchParams.get("address"),
    });
    const chain = input.chain as ChainKey;
    const address = getAddress(input.address);
    const detail = await readCachedMarketDetail(chain, address);
    if (!detail) return NextResponse.json({ error: "Market not found." }, { status: 404 });

    return NextResponse.json(
      detail,
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid market request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read this market." },
      { status: 400 },
    );
  }
}
