import { unstable_cache } from "next/cache";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { readArbitrageOpportunity } from "@/lib/server/arbitrage-opportunity";

export const dynamic = "force-dynamic";

const OPPORTUNITY_REVALIDATE_SECONDS = 15;
// The amount is denominated in the selected market's Reserve Token. Token
// decimals and sensible wallet limits are validated by the caller and the
// execution contract, so this endpoint only needs a conservative uint128 cap.
const MAX_PUBLIC_QUOTE = (1n << 128n) - 1n;

const readCachedOpportunity = unstable_cache(
  async (token: string, amountRaw: string) => readArbitrageOpportunity(getAddress(token), BigInt(amountRaw)),
  ["arbitrage-opportunity-reserve-v1"],
  { revalidate: OPPORTUNITY_REVALIDATE_SECONDS },
);

const requestSchema = z.object({
  token: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
  amountRaw: z.string()
    .regex(/^\d+$/, "Enter a valid Reserve Token budget.")
    .refine((value) => BigInt(value) > 0n && BigInt(value) <= MAX_PUBLIC_QUOTE, "Enter a valid Reserve Token budget."),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = requestSchema.parse({
      token: url.searchParams.get("token"),
      amountRaw: url.searchParams.get("amountRaw"),
    });
    const opportunity = await readCachedOpportunity(getAddress(input.token), input.amountRaw);
    return Response.json(
      { opportunity },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (reason) {
    if (reason instanceof z.ZodError) {
      return Response.json({ error: reason.issues[0]?.message ?? "Invalid opportunity request." }, { status: 400 });
    }
    return Response.json({ error: reason instanceof Error ? reason.message : "The price gap could not be checked." }, { status: 400 });
  }
}
