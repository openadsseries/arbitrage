import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { readContinuousArbitrageSnapshot } from "@/lib/server/arbitrage-v3";

export const dynamic = "force-dynamic";

const querySchema = z.object({ wallet: z.string() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({ wallet: url.searchParams.get("wallet") });
    return NextResponse.json({ snapshot: await readContinuousArbitrageSnapshot(getAddress(input.wallet)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read arbitrage." },
      { status: 400 },
    );
  }
}
