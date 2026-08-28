import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { readUnifiedArbitrageSnapshot } from "@/lib/server/arbitrage-snapshot";
import { rateLimit } from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = rateLimit(request, "arbitrage-snapshot", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Connect wallet." }, { status: 400 });
  }
  try {
    return NextResponse.json({
      snapshot: await readUnifiedArbitrageSnapshot(getAddress(wallet)),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not read arbitrage positions." },
      { status: 503 },
    );
  }
}
