import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import type { ChainKey } from "@/lib/chains";
import { readPortfolio } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  wallet: z.string(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      wallet: url.searchParams.get("wallet"),
    });
    const wallet = getAddress(input.wallet);
    const chains: ChainKey[] = ["base", "robinhood"];
    const results = await Promise.allSettled(chains.map((chain) => readPortfolio(chain, wallet)));
    const portfolios = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const unavailableChains = chains.filter((_, index) => results[index].status === "rejected");
    return NextResponse.json({ portfolios, unavailableChains, source: "Wallet balances, Mint Club and confirmed events" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read portfolio." },
      { status: 400 },
    );
  }
}
