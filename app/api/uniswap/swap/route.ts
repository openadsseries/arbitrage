import { NextResponse } from "next/server";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, isAddress, isAddressEqual, type Address, type Hex } from "viem";
import { z } from "zod";
import { CHAINS } from "@/lib/chains";

export const dynamic = "force-dynamic";

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
const INTERFACE_FEE_BIPS = 100;
const UNISWAP_API = "https://trade-api.gateway.uniswap.org/v1";
const BASE_UNIVERSAL_ROUTERS: readonly Address[] = [
  "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
  "0x6fF5693b99212Da76ad316178A184AB56D299b43",
  "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7",
];

const bodySchema = z.object({
  action: z.enum(["approval", "quote", "transaction"]),
  chain: z.enum(["base", "robinhood"]),
  token: z.string(),
  side: z.enum(["buy", "sell"]),
  amountRaw: z.string().regex(/^\d+$/),
  swapper: z.string(),
});

type UniswapQuote = {
  input?: { amount?: string; token?: string };
  output?: { amount?: string; token?: string; recipient?: string };
  aggregatedOutputs?: Array<{ amount?: string; recipient?: string; fee?: string }>;
  priceImpact?: number;
  [key: string]: unknown;
};

type TransactionRequest = {
  to: string;
  from: string;
  data: string;
  value: string;
  chainId: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
};

function configuration() {
  const apiKey = process.env.UNISWAP_API_KEY?.trim();
  const recipient = process.env.UNISWAP_FEE_RECIPIENT?.trim();
  if (!apiKey || !recipient || !isAddress(recipient)) return null;
  return { apiKey, recipient: getAddress(recipient) };
}

async function uniswapRequest(path: string, apiKey: string, body: unknown) {
  const attempts = path === "quote" ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${UNISWAP_API}/${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
        "x-permit2-disabled": "true",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (response.ok) return payload;
    const retryable = path === "quote" && (response.status === 404 || response.status === 429 || response.status >= 500);
    if (attempt < attempts - 1 && retryable) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    const message = typeof payload.message === "string" ? payload.message : `Uniswap returned ${response.status}.`;
    throw new Error(response.status === 404 && path === "quote"
      ? "A live Uniswap route is temporarily unavailable. Try again."
      : message);
  }
  throw new Error("Uniswap did not return a quote.");
}

function exactApproval(
  request: unknown,
  token: Address,
  swapper: Address,
  chainId: number,
  amount: bigint,
) {
  if (!request || typeof request !== "object") return null;
  const transaction = request as TransactionRequest;
  if (
    !isAddress(transaction.to)
    || !isAddress(transaction.from)
    || !transaction.data
    || !transaction.data.startsWith("0x")
    || transaction.chainId !== chainId
    || !isAddressEqual(getAddress(transaction.to), token)
    || !isAddressEqual(getAddress(transaction.from), swapper)
    || BigInt(transaction.value) !== 0n
  ) throw new Error("The approval does not match the requested token, wallet, or network.");
  const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data as Hex });
  if (decoded.functionName !== "approve" || !decoded.args) throw new Error("Uniswap returned an invalid approval.");
  const [spender] = decoded.args;
  return {
    ...transaction,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
  };
}

function quoteAmounts(quote: UniswapQuote, swapper: string) {
  const coreOutput = quote.aggregatedOutputs?.find((output) => (
    output.fee !== "INTEGRATOR" && output.recipient?.toLowerCase() === swapper.toLowerCase()
  ));
  const feeOutput = quote.aggregatedOutputs?.find((output) => output.fee === "INTEGRATOR");
  return {
    outputAmountRaw: coreOutput?.amount ?? quote.output?.amount,
    feeAmountRaw: feeOutput?.amount,
  };
}

export async function POST(request: Request) {
  try {
    const config = configuration();
    if (!config) {
      return NextResponse.json({
        error: "Trading needs a Uniswap API key and a verified fee recipient.",
        setupRequired: true,
      }, { status: 503 });
    }
    const input = bodySchema.parse(await request.json());
    const token = getAddress(input.token);
    const swapper = getAddress(input.swapper);
    if (BigInt(input.amountRaw) <= 0n) throw new Error("Enter an amount greater than zero.");
    const chainId = CHAINS[input.chain].id;
    const tokenIn = input.side === "buy" ? NATIVE_TOKEN : token;
    const tokenOut = input.side === "buy" ? token : NATIVE_TOKEN;
    if (input.action === "approval") {
      if (input.side === "buy") return NextResponse.json({ approval: null, cancel: null });
      const approvalPayload = await uniswapRequest("check_approval", config.apiKey, {
        walletAddress: swapper,
        token,
        amount: input.amountRaw,
        chainId,
        tokenOut,
        tokenOutChainId: chainId,
      });
      return NextResponse.json({
        approval: exactApproval(approvalPayload.approval, token, swapper, chainId, BigInt(input.amountRaw)),
        cancel: exactApproval(approvalPayload.cancel, token, swapper, chainId, 0n),
      });
    }
    const quotePayload = await uniswapRequest("quote", config.apiKey, {
      tokenIn,
      tokenOut,
      tokenInChainId: chainId,
      tokenOutChainId: chainId,
      type: "EXACT_INPUT",
      amount: input.amountRaw,
      swapper,
      recipient: swapper,
      slippageTolerance: 0.5,
      routingPreference: "BEST_PRICE",
      protocols: ["V2", "V3", "V4"],
      integratorFees: [{ bips: INTERFACE_FEE_BIPS, recipient: config.recipient }],
    });
    if (quotePayload.routing !== "CLASSIC" || !quotePayload.quote || typeof quotePayload.quote !== "object") {
      throw new Error("A direct Uniswap pool route is not available for this trade.");
    }
    const quote = quotePayload.quote as UniswapQuote;
    if (
      quote.input?.amount !== input.amountRaw
      || !quote.input.token
      || !isAddressEqual(getAddress(quote.input.token), getAddress(tokenIn))
      || !quote.output?.token
      || !isAddressEqual(getAddress(quote.output.token), getAddress(tokenOut))
      || (quote.output.recipient && !isAddressEqual(getAddress(quote.output.recipient), swapper))
    ) {
      throw new Error("The Uniswap quote does not match the requested trade.");
    }
    const amounts = quoteAmounts(quote, swapper);
    if (!amounts.outputAmountRaw) throw new Error("Uniswap did not return a valid output amount.");
    if (input.action === "quote") {
      return NextResponse.json({
        outputAmountRaw: amounts.outputAmountRaw,
        feeAmountRaw: amounts.feeAmountRaw ?? null,
        priceImpact: typeof quote.priceImpact === "number" ? quote.priceImpact : null,
        feeBips: INTERFACE_FEE_BIPS,
      });
    }
    const swapPayload = await uniswapRequest("swap", config.apiKey, {
      quote,
      simulateTransaction: true,
      refreshGasPrice: true,
      safetyMode: "SAFE",
    });
    const swap = swapPayload.swap as TransactionRequest | undefined;
    if (!swap || !isAddress(swap.to) || !isAddress(swap.from) || !swap.data || swap.data === "0x") {
      throw new Error("Uniswap returned an invalid transaction.");
    }
    if (getAddress(swap.from) !== swapper || swap.chainId !== chainId) {
      throw new Error("The Uniswap transaction does not match the connected wallet or network.");
    }
    const allowedTargets = input.chain === "base"
      ? [CHAINS.base.swapRouter, ...BASE_UNIVERSAL_ROUTERS]
      : [CHAINS.robinhood.swapRouter];
    if (!allowedTargets.some((target) => isAddressEqual(target, getAddress(swap.to)))) {
      throw new Error("The Uniswap transaction target is not an approved router.");
    }
    const transactionValue = BigInt(swap.value);
    if (
      (input.side === "buy" && transactionValue !== BigInt(input.amountRaw))
      || (input.side === "sell" && transactionValue !== 0n)
    ) {
      throw new Error("The Uniswap transaction value does not match the requested trade.");
    }
    return NextResponse.json({ swap, outputAmountRaw: amounts.outputAmountRaw, feeBips: INTERFACE_FEE_BIPS });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid trade request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The Uniswap trade could not be prepared." },
      { status: 422 },
    );
  }
}
