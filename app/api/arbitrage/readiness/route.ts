import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { ChainKey } from "@/lib/chains";
import { readArbitrageMarketReadiness } from "@/lib/server/arbitrage";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  chain: z.enum(["base", "robinhood"]),
  token: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      chain: url.searchParams.get("chain"),
      token: url.searchParams.get("token"),
    });
    const readiness = await readArbitrageMarketReadiness(
      input.chain as ChainKey,
      getAddress(input.token),
    );
    return NextResponse.json({ readiness, source: "Mint Club, Uniswap and executor contracts" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid arbitrage request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read arbitrage readiness." },
      { status: 400 },
    );
  }
}
