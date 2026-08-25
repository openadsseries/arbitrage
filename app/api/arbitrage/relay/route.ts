import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { z } from "zod";
import { ARBITRAGE_EXECUTOR_V3_ABI } from "@/lib/arbitrage";
import { compactActionError } from "@/lib/errors";
import { readDirectArbitrageExecutionStatus } from "@/lib/server/arbitrage-execution";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  owner: z.string().refine(isAddress, "Connect wallet."),
  strategyId: z.string().regex(/^\d+$/, "Invalid position."),
});

function relayPrivateKey() {
  const privateKey = process.env.ARBITRAGE_RELAYER_PRIVATE_KEY || process.env.ARBITRAGE_KEEPER_PRIVATE_KEY;
  if (!privateKey) throw new Error("Relay not configured.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Relay key invalid.");
  return privateKey as `0x${string}`;
}

function rpcUrl() {
  const url = process.env.BASE_RPC_URL;
  if (!url) throw new Error("Relay not configured.");
  return url;
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const account = privateKeyToAccount(relayPrivateKey());
    const transport = http(rpcUrl(), { timeout: 12_000 });
    const publicClient = createPublicClient({ chain: base, transport });
    const walletClient = createWalletClient({ account, chain: base, transport });
    const quote = await readDirectArbitrageExecutionStatus({
      owner: getAddress(input.owner),
      strategyId: BigInt(input.strategyId),
      executionAccount: account.address,
      client: publicClient as unknown as Parameters<typeof readDirectArbitrageExecutionStatus>[0]["client"],
    });
    if (quote.status !== "ready") {
      return NextResponse.json(
        { status: quote.status, execution: "execution" in quote ? quote.execution : null, error: compactActionError(new Error(quote.error), "Watching.") },
      );
    }
    const execution = quote.execution;
    const args = [
      BigInt(execution.strategyId),
      execution.direction,
      {
        amountInReserve: BigInt(execution.params.amountInReserve),
        hAmountForMint: BigInt(execution.params.hAmountForMint),
        minimumWethOut: BigInt(execution.params.minimumWethOut),
        minimumHypedOut: BigInt(execution.params.minimumHypedOut),
        minimumBondOut: BigInt(execution.params.minimumBondOut),
        minimumReserveOut: BigInt(execution.params.minimumReserveOut),
      },
    ] as const;
    const simulation = await publicClient.simulateContract({
      account,
      address: execution.executor,
      abi: ARBITRAGE_EXECUTOR_V3_ABI,
      functionName: "execute",
      args,
      blockTag: "pending",
    });
    const hash = await walletClient.writeContract(simulation.request);
    return NextResponse.json({ status: "executed", hash, execution });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: compactActionError(error, "Watching.") },
      { status: 409 },
    );
  }
}
