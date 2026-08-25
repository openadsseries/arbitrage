import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { ChainKey } from "@/lib/chains";
import { prepareArbitrageStrategy } from "@/lib/server/arbitrage";

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
    const preparation = await prepareArbitrageStrategy(input.chain as ChainKey, getAddress(input.token));
    return NextResponse.json({ preparation, source: "Mint Club and Uniswap contracts" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid arbitrage request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare arbitrage." },
      { status: 400 },
    );
  }
}
