import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { assessPublicArbitrageOpportunity } from "@/lib/arbitrage";
import {
  MAX_PUBLIC_ARBITRAGE_QUOTE,
  readCachedArbitrageOpportunity,
} from "@/lib/server/arbitrage-opportunity-cache";
import {
  rateLimit,
  readBoundedJson,
  RequestGuardError,
  requireSameOriginJson,
} from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

const itemSchema = z.object({
  token: z.string().refine(isAddress, "Enter a valid Hyped Token address."),
  amountRaw: z
    .string()
    .regex(/^\d+$/, "Enter a valid Reserve Token budget.")
    .refine(
      (value) =>
        BigInt(value) > 0n && BigInt(value) <= MAX_PUBLIC_ARBITRAGE_QUOTE,
      "Enter a valid Reserve Token budget.",
    ),
});

const requestSchema = z.object({
  items: z.array(itemSchema).min(1).max(20),
});

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  read: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await read(items[index]);
      }
    }),
  );
  return results;
}

export async function POST(request: Request) {
  const forbidden = requireSameOriginJson(request);
  if (forbidden) return forbidden;
  const limited = rateLimit(request, "arbitrage-opportunities", {
    limit: 15,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    const input = requestSchema.parse(await readBoundedJson(request, 8_192));
    const opportunities = await mapWithConcurrency(
      input.items,
      4,
      async (item) => {
        const opportunity = await readCachedArbitrageOpportunity(
          getAddress(item.token),
          item.amountRaw,
        );
        return {
          token: getAddress(item.token),
          assessment: assessPublicArbitrageOpportunity(opportunity),
          // Keep the quote during rolling deployments for already-open tabs.
          opportunity,
        };
      },
    );
    return Response.json(
      { opportunities },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (reason) {
    if (reason instanceof RequestGuardError) {
      return Response.json(
        { error: reason.message },
        { status: reason.status },
      );
    }
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
            : "The price gaps could not be checked.",
      },
      { status: 400 },
    );
  }
}
