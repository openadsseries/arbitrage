import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { compactActionError } from "@/lib/errors";
import { buildDirectArbitrageExecution } from "@/lib/server/arbitrage-execution";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  owner: z.string().refine(isAddress, "Connect wallet."),
  strategyId: z.string().regex(/^\d+$/, "Invalid position."),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const execution = await buildDirectArbitrageExecution({
      owner: getAddress(input.owner),
      strategyId: BigInt(input.strategyId),
    });
    return NextResponse.json({ execution });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: compactActionError(error, "Not executable now.") },
      { status: 409 },
    );
  }
}
