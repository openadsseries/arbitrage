import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { readArbitrageSnapshot } from "@/lib/server/arbitrage";

export const dynamic = "force-dynamic";

const querySchema = z.object({ wallet: z.string() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({ wallet: url.searchParams.get("wallet") });
    const snapshot = await readArbitrageSnapshot(getAddress(input.wallet));
    return NextResponse.json({ snapshot, source: "Immutable execution contract events" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read arbitrage." },
      { status: 400 },
    );
  }
}
