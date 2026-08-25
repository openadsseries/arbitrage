import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { ChainKey } from "@/lib/chains";
import { readVerifiedMarket } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  address: z.string().refine(isAddress, "Enter a valid contract address."),
  chain: z.enum(["base", "robinhood"]).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      address: url.searchParams.get("address"),
      chain: url.searchParams.get("chain") ?? undefined,
    });
    const address = getAddress(input.address);
    const chains: ChainKey[] = input.chain ? [input.chain] : ["base", "robinhood"];
    const markets = [];
    // The Mint Club SDK keeps network-scoped clients internally. Reading two networks in
    // parallel can cross-contaminate a token lookup, so address discovery is intentionally
    // sequential. The common path always supplies `chain` and performs one read.
    for (const chain of chains) {
      try {
        const market = await readVerifiedMarket(chain, address);
        if (market) markets.push(market);
      } catch {
        // Continue to the next supported network when this network is unavailable.
      }
    }
    if (markets.length === 0) return NextResponse.json({ error: "Market not found on supported networks." }, { status: 404 });
    return NextResponse.json({ markets, source: "Mint Club and Uniswap contracts" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid market request." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not read market.";
    return NextResponse.json(
      { error: message.includes("valid contract address") ? message : "Could not read this market." },
      { status: 400 },
    );
  }
}
