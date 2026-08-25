import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { readReserveArbitrageSnapshot } from "@/lib/server/arbitrage-v2";

export const dynamic = "force-dynamic";

const querySchema = z.object({ wallet: z.string() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({ wallet: url.searchParams.get("wallet") });
    return NextResponse.json({ snapshot: await readReserveArbitrageSnapshot(getAddress(input.wallet)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read Reserve Token arbitrage." },
      { status: 400 },
    );
  }
}
