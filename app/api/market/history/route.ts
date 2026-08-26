import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { ChainKey } from "@/lib/chains";
import { readFreshMarketComparison } from "@/lib/server/market-snapshots";
import { rateLimit } from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  chain: z.enum(["base", "robinhood"]),
  address: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
});

export async function GET(request: Request) {
  const limited = rateLimit(request, "market-history", { limit: 6, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      chain: url.searchParams.get("chain"),
      address: url.searchParams.get("address"),
    });
    const comparison = await readFreshMarketComparison(
      input.chain as ChainKey,
      getAddress(input.address),
    );
    if (!comparison) return Response.json({ error: "Market not found." }, { status: 404 });
    return Response.json(
      { comparison },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Invalid market request." },
        { status: 400 },
      );
    }
    return Response.json({ error: "Price history could not be checked." }, { status: 503 });
  }
}
