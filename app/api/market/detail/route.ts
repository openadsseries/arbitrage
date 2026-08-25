import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { ChainKey } from "@/lib/chains";
import { readMarketDetailSnapshot } from "@/lib/server/market-snapshots";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  chain: z.enum(["base", "robinhood"]),
  address: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      chain: url.searchParams.get("chain"),
      address: url.searchParams.get("address"),
    });
    const chain = input.chain as ChainKey;
    const address = getAddress(input.address);
    const detail = await readMarketDetailSnapshot(chain, address);
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
