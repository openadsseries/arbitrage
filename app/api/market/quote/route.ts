import { mintclub } from "@mint.club/v2-sdk";
import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";

export const dynamic = "force-dynamic";

const quoteSchema = z.object({
  chain: z.enum(["base", "robinhood"]),
  token: z.string(),
  tokenAmountRaw: z.string().regex(/^[1-9]\d*$/),
  side: z.enum(["buy", "sell"]).default("buy"),
});

export async function POST(request: Request) {
  try {
    const input = quoteSchema.parse(await request.json());
    const network = mintclub.network(input.chain);
    const token = network.token(getAddress(input.token));
    if (!(await token.exists())) {
      return NextResponse.json({ error: "This market is not available." }, { status: 404 });
    }
    const [blockNumber, estimation] = await Promise.all([
      network.getPublicClient().getBlockNumber(),
      input.side === "buy"
        ? token.getBuyEstimation(BigInt(input.tokenAmountRaw))
        : token.getSellEstimation(BigInt(input.tokenAmountRaw)),
    ]);
    return NextResponse.json({
      tokenAmountRaw: input.tokenAmountRaw,
      reserveAmountRaw: estimation[0].toString(),
      royaltyRaw: estimation[1].toString(),
      blockNumber: blockNumber.toString(),
      readAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "A live price is unavailable." }, { status: 400 });
  }
}
