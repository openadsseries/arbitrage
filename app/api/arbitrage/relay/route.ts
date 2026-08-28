import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  getAddress,
  http,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { z } from "zod";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ARBITRAGE_EXECUTOR_V4_ABI,
  type ArbitrageExecutorVersion,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import { compactActionError } from "@/lib/errors";
import { readDirectArbitrageExecutionStatus } from "@/lib/server/arbitrage-execution";
import { readDirectArbitrageExecutionStatusV4 } from "@/lib/server/arbitrage-execution";
import {
  rateLimit,
  readBoundedJson,
  RequestGuardError,
} from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  owner: z.string().refine(isAddress, "Connect wallet."),
  strategyId: z.string().regex(/^\d+$/, "Invalid position."),
  version: z.enum(["v3", "v4"]),
});
const statusRequestSchema = requestSchema.partial().refine(
  (value) =>
    (value.owner === undefined &&
      value.strategyId === undefined &&
      value.version === undefined) ||
    (value.owner !== undefined &&
      value.strategyId !== undefined &&
      value.version !== undefined),
  "Invalid position.",
);
const EXPECTED_EXECUTOR = "0xbB7AF71818fD1a269f21D0b5E4d8F7CF5401Ac3C";
const EXPECTED_DEPLOYMENT_BLOCK = "50422622";
const EXPECTED_ROUTER = "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02";

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

function minimumRelayBalance() {
  const configured = process.env.ARBITRAGE_RELAY_MIN_BALANCE_WEI?.trim();
  if (!configured) return 100_000_000_000_000n;
  if (!/^\d+$/.test(configured))
    throw new Error("Relay minimum balance invalid.");
  return BigInt(configured);
}

function reserveRelayGas(amount: bigint) {
  const current = currentRelayGasBudget();
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

function currentRelayGasBudget() {
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
  return current;
}

function rpcUrl() {
  const url = process.env.BASE_RPC_URL;
  if (!url) throw new Error("Relay not configured.");
  return url;
}

async function relayContext(version: ArbitrageExecutorVersion) {
  const account = privateKeyToAccount(relayPrivateKey());
  const primaryRpc = rpcUrl();
  const rpcEndpoints = [primaryRpc, "https://mainnet.base.org"].filter(
    (url, index, endpoints) => endpoints.indexOf(url) === index,
  );
  const transport = fallback(
    rpcEndpoints.map((url) => http(url, { retryCount: 0, timeout: 8_000 })),
    { rank: false, retryCount: 0 },
  );
  const publicClient = createPublicClient({ chain: base, transport });
  const executorValue =
    version === "v4"
      ? process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4
      : process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V3;
  if (!executorValue || !isAddress(executorValue)) {
    throw new Error("Arbitrage contract not configured.");
  }
  const executor = getAddress(executorValue);
  if (version === "v3" && executor !== getAddress(EXPECTED_EXECUTOR)) {
    throw new Error("Arbitrage contract address changed.");
  }
  if (
    version === "v3" &&
    process.env.ARBITRAGE_EXECUTOR_V3_DEPLOYMENT_BLOCK?.trim() !==
      EXPECTED_DEPLOYMENT_BLOCK
  ) {
    throw new Error("Arbitrage deployment block changed.");
  }
  const abi =
    version === "v4" ? ARBITRAGE_EXECUTOR_V4_ABI : ARBITRAGE_EXECUTOR_V3_ABI;
  const [chainId, balance, code, protocolFeeBps, executorRewardBps, weth, mintClubBond, onchainRouter] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBalance({ address: account.address }),
    publicClient.getCode({ address: executor }),
    publicClient.readContract({
      address: executor,
      abi,
      functionName: "protocolFeeBps",
    }),
    publicClient.readContract({
      address: executor,
      abi,
      functionName:
        version === "v4" ? "executorProfitShareBps" : "executorRewardBps",
    }),
    publicClient.readContract({
      address: executor,
      abi,
      functionName: "weth",
    }),
    publicClient.readContract({
      address: executor,
      abi,
      functionName: "mintClubBond",
    }),
    publicClient.readContract({
      address: executor,
      abi,
      functionName: "onchainRouter",
    }),
  ]);
  if (chainId !== base.id) throw new Error("Relay is not connected to Base.");
  if (!code || code === "0x") throw new Error("Arbitrage contract not found.");
  const expectedRewardBps = version === "v4" ? 1_000 : 2_000;
  if (protocolFeeBps !== 0 || executorRewardBps !== expectedRewardBps) {
    throw new Error("Arbitrage fee policy changed.");
  }
  if (getAddress(weth) !== CHAINS.base.weth)
    throw new Error("Arbitrage WETH address changed.");
  if (getAddress(mintClubBond) !== CHAINS.base.mintClubBond)
    throw new Error("Mint Club address changed.");
  if (getAddress(onchainRouter) !== getAddress(EXPECTED_ROUTER))
    throw new Error("Arbitrage router changed.");
  if (version === "v4") {
    const [trustedExecutor, paused] = await Promise.all([
      publicClient.readContract({
        address: executor,
        abi: ARBITRAGE_EXECUTOR_V4_ABI,
        functionName: "trustedExecutor",
      }),
      publicClient.readContract({
        address: executor,
        abi: ARBITRAGE_EXECUTOR_V4_ABI,
        functionName: "paused",
      }),
    ]);
    if (getAddress(trustedExecutor) !== account.address)
      throw new Error("Relay is not authorized.");
    if (paused) throw new Error("Relay is paused.");
  }
  return { account, balance, executor, publicClient, transport, version };
}

function activeRelayVersion(): ArbitrageExecutorVersion {
  return process.env.NEXT_PUBLIC_ARBITRAGE_V4_ENABLED === "true" ? "v4" : "v3";
}

function readExecutionStatus(
  version: ArbitrageExecutorVersion,
  input: Parameters<typeof readDirectArbitrageExecutionStatus>[0],
) {
  return version === "v4"
    ? readDirectArbitrageExecutionStatusV4(input)
    : readDirectArbitrageExecutionStatus(input);
}

export async function GET(request: Request) {
  const limited = rateLimit(request, "arbitrage-relay-status", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    const url = new URL(request.url);
    const input = statusRequestSchema.parse({
      owner: url.searchParams.get("owner") ?? undefined,
      strategyId: url.searchParams.get("strategyId") ?? undefined,
      version: url.searchParams.get("version") ?? undefined,
    });
    const version = input.version ?? activeRelayVersion();
    const { account, balance, publicClient } = await relayContext(version);
    const requiredBalance = minimumRelayBalance();
    if (balance < requiredBalance) {
      return NextResponse.json({
        ready: false,
        state: "low-balance",
        message: "Relay needs Base ETH.",
        balanceRaw: balance.toString(),
        requiredBalanceRaw: requiredBalance.toString(),
      });
    }
    const gasBudget = currentRelayGasBudget();
    if (gasBudget.spent + gasBudget.reserved >= dailyGasLimit()) {
      return NextResponse.json({
        ready: false,
        state: "paused",
        message: "Relay paused for today.",
        balanceRaw: balance.toString(),
        requiredBalanceRaw: requiredBalance.toString(),
      });
    }
    const relayStatus = {
      ready: true,
      state: "ready",
      message: "Automatic execution is ready.",
      balanceRaw: balance.toString(),
      requiredBalanceRaw: requiredBalance.toString(),
    } as const;
    if (!input.owner || !input.strategyId) {
      return NextResponse.json(relayStatus);
    }
    const strategy = await readExecutionStatus(version, {
      owner: getAddress(input.owner),
      strategyId: BigInt(input.strategyId),
      executionAccount: account.address,
      client: publicClient as unknown as Parameters<
        typeof readDirectArbitrageExecutionStatus
      >[0]["client"],
    });
    return NextResponse.json({
      ...relayStatus,
      strategy: {
        status: strategy.status,
        code: strategy.code,
        execution: "execution" in strategy ? strategy.execution : null,
        error: "error" in strategy ? strategy.error : null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid position." },
        { status: 400 },
      );
    }
    let requiredBalanceRaw = "100000000000000";
    try {
      requiredBalanceRaw = minimumRelayBalance().toString();
    } catch {
      // Keep status readable when the configured value itself is invalid.
    }
    return NextResponse.json({
      ready: false,
      state: "setup-needed",
      message: compactActionError(error, "Relay setup needed."),
      balanceRaw: null,
      requiredBalanceRaw,
    });
  }
}

export async function POST(request: Request) {
  const generalLimit = rateLimit(request, "arbitrage-relay", {
    limit: 12,
    windowMs: 60_000,
  });
  if (generalLimit) return generalLimit;
  try {
    const input = requestSchema.parse(await readBoundedJson(request, 4_096));
    const lockKey = `${input.version}:${input.owner.toLowerCase()}:${input.strategyId}`;
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
      const { account, balance, executor, publicClient, transport } =
        await relayContext(input.version);
      if (balance < minimumRelayBalance()) {
        throw new Error("Relay needs Base ETH.");
      }
      const gasBudget = currentRelayGasBudget();
      if (gasBudget.spent + gasBudget.reserved >= dailyGasLimit()) {
        throw new Error("Relay paused for today.");
      }
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport,
      });
      const quote = await readExecutionStatus(input.version, {
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
          code: quote.code,
          execution: "execution" in quote ? quote.execution : null,
          error: compactActionError(new Error(quote.error), "Watching."),
        });
      }
      const execution = quote.execution;
      if (balance < BigInt(execution.requiredWethRaw)) {
        throw new Error("Relay needs Base ETH.");
      }
      const settleGasReservation = reserveRelayGas(
        BigInt(execution.totalFeeWethRaw),
      );
      try {
        let hash: `0x${string}`;
        if (input.version === "v4") {
          const simulation = await publicClient.simulateContract({
                account,
                address: executor,
                abi: ARBITRAGE_EXECUTOR_V4_ABI,
                functionName: "execute",
                args: [
                  BigInt(execution.strategyId),
                  execution.direction,
                  {
                    amountInReserve: BigInt(execution.params.amountInReserve),
                    hAmountForMint: BigInt(execution.params.hAmountForMint),
                    minimumHypedOut: BigInt(execution.params.minimumHypedOut),
                    minimumBondOut: BigInt(execution.params.minimumBondOut),
                    minimumReserveOut: BigInt(execution.params.minimumReserveOut),
                    feeReimbursementWei: BigInt(
                      execution.params.feeReimbursementWei ?? "0",
                    ),
                  },
                ],
                blockTag: "pending",
              });
          hash = await walletClient.writeContract(simulation.request);
        } else {
          const simulation = await publicClient.simulateContract({
                account,
                address: executor,
                abi: ARBITRAGE_EXECUTOR_V3_ABI,
                functionName: "execute",
                args: [
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
                ],
                blockTag: "pending",
              });
          hash = await walletClient.writeContract(simulation.request);
        }
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
