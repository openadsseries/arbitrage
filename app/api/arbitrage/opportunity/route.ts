import { getAddress, isAddress } from "viem";
import { z } from "zod";
import {
  MAX_PUBLIC_ARBITRAGE_QUOTE,
  readCachedArbitrageOpportunity,
} from "@/lib/server/arbitrage-opportunity-cache";
import { rateLimit } from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  token: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
  amountRaw: z
    .string()
    .regex(/^\d+$/, "Enter a valid Reserve Token budget.")
    .refine(
      (value) =>
        BigInt(value) > 0n && BigInt(value) <= MAX_PUBLIC_ARBITRAGE_QUOTE,
      "Enter a valid Reserve Token budget.",
    ),
  mode: z.enum(["exact", "optimize"]).optional(),
});

export async function GET(request: Request) {
  const limited = rateLimit(request, "arbitrage-opportunity", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    const url = new URL(request.url);
    const input = requestSchema.parse({
      token: url.searchParams.get("token"),
      amountRaw: url.searchParams.get("amountRaw"),
      mode: url.searchParams.get("mode") ?? undefined,
    });
    const opportunity = await readCachedArbitrageOpportunity(
      getAddress(input.token),
      input.amountRaw,
      input.mode ?? "optimize",
    );
    return Response.json(
      { opportunity },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (reason) {
    if (reason instanceof z.ZodError) {
      return Response.json(
        { error: reason.issues[0]?.message ?? "Invalid opportunity request." },
        { status: 400 },
      );
    }
    return Response.json(
      {
        error:
          reason instanceof Error
            ? reason.message
            : "The route return could not be checked.",
      },
      { status: 400 },
    );
  }
}
