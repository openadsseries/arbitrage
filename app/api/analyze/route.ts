import { NextResponse } from "next/server";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { z } from "zod";
import { findCanonicalAsset, getChain, getViemChain, type ChainKey } from "@/lib/chains";
import { readTokenMarketPrice } from "@/lib/server/gecko-market";
import type { RiskStatus, TokenAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  tokenAddress: z.string().trim(),
  chain: z.enum(["base", "robinhood"]).optional(),
});

class TokenNotFoundError extends Error {}

async function analyzeOnChain(chainKey: ChainKey, tokenAddress: `0x${string}`, usePublicRpc = false): Promise<TokenAnalysis> {
  const capability = getChain(chainKey);
  if (!capability) throw new Error("Unsupported network.");
  const configuredRpc = chainKey === "base" ? process.env.BASE_RPC_URL : process.env.ROBINHOOD_RPC_URL;
  const rpcUrl = usePublicRpc ? capability.rpcUrl : configuredRpc || capability.rpcUrl;
  const chain = getViemChain(chainKey);
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 8_000 }) });
  const bytecode = await client.getCode({ address: tokenAddress });
  if (!bytecode || bytecode === "0x") throw new TokenNotFoundError();

  const [blockNumber, metadata, marketPrice] = await Promise.all([
    client.getBlockNumber(),
    client.multicall({
      allowFailure: false,
      contracts: [
        { address: tokenAddress, abi: erc20Abi, functionName: "name" },
        { address: tokenAddress, abi: erc20Abi, functionName: "symbol" },
        { address: tokenAddress, abi: erc20Abi, functionName: "decimals" },
        { address: tokenAddress, abi: erc20Abi, functionName: "totalSupply" },
      ],
    }),
    readTokenMarketPrice(chainKey, tokenAddress),
  ]);
  const [name, symbol, decimals, totalSupply] = metadata;
  const canonical = findCanonicalAsset(capability, tokenAddress);
  const riskReasons: string[] = [];
  let riskStatus: RiskStatus = "supported";

  if (!canonical) {
    riskStatus = "warning";
    riskReasons.push("Non-standard assets require transfer-tax, blacklist and rebase simulation before execution.");
  }
  if (capability.status === "beta") {
    riskReasons.push("Robinhood Chain support is beta. Deployment addresses and liquidity routes require a fresh check before execution.");
    if (riskStatus === "supported") riskStatus = "warning";
  }
  if (decimals > 18) {
    riskStatus = "blocked";
    riskReasons.push("Token precision above 18 decimals is not supported by the current policy.");
  }

  return {
    chain: capability.key,
    chainId: capability.id,
    tokenAddress,
    name,
    symbol,
    decimals,
    totalSupplyRaw: totalSupply.toString(),
    totalSupplyFormatted: formatUnits(totalSupply, decimals),
    blockNumber: blockNumber.toString(),
    analyzedAt: new Date().toISOString(),
    riskStatus,
    riskReasons,
    marketPrice,
    capabilities: {
      metadataReadable: true,
      transferPreflightRequired: !canonical,
    },
  };
}

async function analyzeWithRetry(chain: ChainKey, tokenAddress: `0x${string}`) {
  try {
    return await analyzeOnChain(chain, tokenAddress);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return analyzeOnChain(chain, tokenAddress, true);
  }
}

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const tokenAddress = getAddress(input.tokenAddress);
    const chains: ChainKey[] = input.chain ? [input.chain] : ["base", "robinhood"];
    const results = await Promise.allSettled(chains.map((chain) => analyzeWithRetry(chain, tokenAddress)));
    const analyses = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (analyses.length === 0) {
      const unavailable = results.some(
        (result) => result.status === "rejected" && !(result.reason instanceof TokenNotFoundError),
      );
      return NextResponse.json(
        {
          error: unavailable
            ? "The token could not be verified right now. Check the address and try again."
            : "No token was found at this address on Base or Robinhood.",
        },
        { status: unavailable ? 503 : 404 },
      );
    }
    return NextResponse.json({ analyses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze this token.";
    return NextResponse.json(
      { error: message.includes("Address") ? "Enter a valid contract address." : "Could not read this token. Check the address and try again." },
      { status: 400 },
    );
  }
}
