import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { z } from "zod";
import { ARBITRAGE_EXECUTOR_V3_ABI } from "@/lib/arbitrage";
import { compactActionError } from "@/lib/errors";
import { readDirectArbitrageExecutionStatus } from "@/lib/server/arbitrage-execution";
import {
  rateLimit,
  readBoundedJson,
  RequestGuardError,
} from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  owner: z.string().refine(isAddress, "Connect wallet."),
  strategyId: z.string().regex(/^\d+$/, "Invalid position."),
});

function relayPrivateKey() {
  const privateKey = process.env.ARBITRAGE_RELAYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("Relay not configured.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey))
    throw new Error("Relay key invalid.");
  return privateKey as `0x${string}`;
}

const relayLocks = new Set<string>();
type RelayGasBudget = { day: string; spent: bigint; reserved: bigint };
const relayBudgetStore = globalThis as typeof globalThis & {
  __gethypedRelayGasBudget?: RelayGasBudget;
};

function dailyGasLimit() {
  const configured = process.env.ARBITRAGE_RELAY_DAILY_GAS_WEI?.trim();
  if (!configured) return 1_000_000_000_000_000n;
  if (!/^\d+$/.test(configured)) throw new Error("Relay gas limit invalid.");
  return BigInt(configured);
}

function reserveRelayGas(amount: bigint) {
  const day = new Date().toISOString().slice(0, 10);
  const budget = relayBudgetStore.__gethypedRelayGasBudget;
  if (!budget || budget.day !== day) {
    relayBudgetStore.__gethypedRelayGasBudget = {
      day,
      spent: 0n,
      reserved: 0n,
    };
  }
  const current = relayBudgetStore.__gethypedRelayGasBudget!;
  if (current.spent + current.reserved + amount > dailyGasLimit()) {
    throw new Error("Relay paused for today.");
  }
  current.reserved += amount;
  let settled = false;
  return (broadcast: boolean) => {
    if (settled) return;
    settled = true;
    current.reserved -= amount;
    if (broadcast) current.spent += amount;
  };
}

function rpcUrl() {
  const url = process.env.BASE_RPC_URL;
  if (!url) throw new Error("Relay not configured.");
  return url;
}

export async function POST(request: Request) {
  const generalLimit = rateLimit(request, "arbitrage-relay", {
    limit: 12,
    windowMs: 60_000,
  });
  if (generalLimit) return generalLimit;
  try {
    const input = requestSchema.parse(await readBoundedJson(request, 4_096));
    const lockKey = `${input.owner.toLowerCase()}:${input.strategyId}`;
    const strategyLimit = rateLimit(request, "arbitrage-strategy", {
      key: lockKey,
      limit: 4,
      windowMs: 60_000,
    });
    if (strategyLimit) return strategyLimit;
    if (relayLocks.has(lockKey)) {
      return NextResponse.json(
        { status: "none", error: "Execution is already being checked." },
        { status: 409 },
      );
    }
    relayLocks.add(lockKey);
    try {
      const account = privateKeyToAccount(relayPrivateKey());
      const transport = http(rpcUrl(), { timeout: 12_000 });
      const publicClient = createPublicClient({ chain: base, transport });
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport,
      });
      const quote = await readDirectArbitrageExecutionStatus({
        owner: getAddress(input.owner),
        strategyId: BigInt(input.strategyId),
        executionAccount: account.address,
        client: publicClient as unknown as Parameters<
          typeof readDirectArbitrageExecutionStatus
        >[0]["client"],
      });
      if (quote.status !== "ready") {
        return NextResponse.json({
          status: quote.status,
          execution: "execution" in quote ? quote.execution : null,
          error: compactActionError(new Error(quote.error), "Watching."),
        });
      }
      const execution = quote.execution;
      const settleGasReservation = reserveRelayGas(
        BigInt(execution.totalFeeWethRaw),
      );
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
      try {
        const simulation = await publicClient.simulateContract({
          account,
          address: execution.executor,
          abi: ARBITRAGE_EXECUTOR_V3_ABI,
          functionName: "execute",
          args,
          blockTag: "pending",
        });
        const hash = await walletClient.writeContract(simulation.request);
        settleGasReservation(true);
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: 20_000,
          });
          if (receipt.status !== "success")
            throw new Error("Execution did not confirm.");
          return NextResponse.json({
            status: "executed",
            hash,
            execution,
            pending: false,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Execution did not confirm."
          )
            throw error;
          return NextResponse.json({
            status: "executed",
            hash,
            execution,
            pending: true,
          });
        }
      } catch (error) {
        settleGasReservation(false);
        throw error;
      }
    } finally {
      relayLocks.delete(lockKey);
    }
  } catch (error) {
    if (error instanceof RequestGuardError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: compactActionError(error, "Watching.") },
      { status: 409 },
    );
  }
}
