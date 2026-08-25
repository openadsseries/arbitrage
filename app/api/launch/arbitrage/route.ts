import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { previewArbitrageRoutes } from "@/lib/server/launch-liquidity";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  chain: z.enum(["base", "robinhood"]),
  hypedToken: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
  hypedAmountRaw: z.string().regex(/^\d+$/),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const preview = await previewArbitrageRoutes({
      chain: input.chain,
      hypedToken: getAddress(input.hypedToken),
      hypedAmount: BigInt(input.hypedAmountRaw),
    });
    return Response.json({ preview });
  } catch (reason) {
    if (reason instanceof z.ZodError) {
      return Response.json({ error: reason.issues[0]?.message ?? "Invalid route request." }, { status: 400 });
    }
    const message = reason instanceof Error ? reason.message : "The route preview failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
