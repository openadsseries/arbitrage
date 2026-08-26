import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { getChain } from "@/lib/chains";
import { prepareLaunchLiquidity } from "@/lib/server/launch-liquidity";
import {
  rateLimit,
  readBoundedJson,
  RequestGuardError,
} from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  chain: z.enum(["base", "robinhood"]),
  owner: z.string().refine(isAddress, "Connect a valid wallet."),
  hypedToken: z
    .string()
    .refine(isAddress, "Enter a valid Hyped Token address."),
  hypedAmountRaw: z.string().regex(/^\d+$/),
  reserveReferenceRaw: z.string().regex(/^\d+$/).optional(),
});

export async function POST(request: Request) {
  const limited = rateLimit(request, "launch-liquidity", {
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    const input = requestSchema.parse(await readBoundedJson(request, 8_192));
    if (!getChain(input.chain))
      return Response.json({ error: "Unsupported network." }, { status: 400 });
    const preparation = await prepareLaunchLiquidity({
      chain: input.chain,
      owner: getAddress(input.owner),
      hypedToken: getAddress(input.hypedToken),
      hypedAmount: BigInt(input.hypedAmountRaw),
      reserveReference: input.reserveReferenceRaw
        ? BigInt(input.reserveReferenceRaw)
        : undefined,
    });
    return Response.json({ preparation });
  } catch (reason) {
    if (reason instanceof RequestGuardError) {
      return Response.json(
        { error: reason.message },
        { status: reason.status },
      );
    }
    if (reason instanceof z.ZodError) {
      return Response.json(
        { error: reason.issues[0]?.message ?? "Invalid liquidity request." },
        { status: 400 },
      );
    }
    const message =
      reason instanceof Error
        ? reason.message
        : "The connected-market check failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
