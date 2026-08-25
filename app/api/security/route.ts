import { NextResponse } from "next/server";
import type { ChainKey } from "@/lib/chains";
import { readContractHealth } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const chains: ChainKey[] = ["base", "robinhood"];
    const results = await Promise.allSettled(chains.map((chain) => readContractHealth(chain)));
    const health = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const unavailableChains = chains.filter((_, index) => results[index].status === "rejected");
    if (health.length === 0) throw new Error("Could not verify supported deployments.");
    return NextResponse.json({ health, unavailableChains, source: "Contract bytecode across supported networks" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not verify deployments." },
      { status: 502 },
    );
  }
}
