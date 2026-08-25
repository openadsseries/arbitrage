import "server-only";

import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import { CHAINS, type ChainKey } from "@/lib/chains";

const UNISWAP_API = "https://trade-api.gateway.uniswap.org/v1";
const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
const CACHE_MS = 5 * 60 * 1000;

export type DirectUniswapMarket = {
  protocol: "V2" | "V3" | "V4";
  reference: `0x${string}`;
  quoteToken: Address;
  quoteSymbol: string;
  fee: number | null;
  liquidityRaw: string | null;
};

export type DirectUniswapMarketCheck =
  | { status: "found"; market: DirectUniswapMarket }
  | { status: "not-found"; market: null }
  | { status: "unavailable"; market: null };

type RouteLeg = {
  type?: string;
  address?: string;
  tokenIn?: { address?: string };
  tokenOut?: { address?: string; symbol?: string };
  fee?: string;
  liquidity?: string;
  amountOut?: string;
};

const cache = new Map<string, { expiresAt: number; value: DirectUniswapMarketCheck }>();

function protocolOf(type: string | undefined): DirectUniswapMarket["protocol"] | null {
  if (type === "v2-pool") return "V2";
  if (type === "v3-pool") return "V3";
  if (type === "v4-pool") return "V4";
  return null;
}

function parseIndependentPoolRoute(route: unknown, token: Address): DirectUniswapMarket | null {
  if (!Array.isArray(route)) return null;
  const firstLegs = route.flatMap((path) => Array.isArray(path) && path.length > 0 ? [path[0]] : []) as RouteLeg[];
  const candidates = firstLegs.flatMap((leg) => {
    const protocol = protocolOf(leg.type);
    if (
      !protocol
      || !leg.address?.startsWith("0x")
      || !leg.tokenIn?.address
      || !leg.tokenOut?.address
      || !isAddress(leg.tokenIn.address)
      || !isAddress(leg.tokenOut.address)
      || !isAddressEqual(getAddress(leg.tokenIn.address), token)
    ) return [];
    const quoteToken = getAddress(leg.tokenOut.address);
    return [{
      protocol,
      reference: leg.address as `0x${string}`,
      quoteToken,
      quoteSymbol: leg.tokenOut.symbol === "WETH"
        ? "ETH"
        : (leg.tokenOut.symbol ?? (isAddressEqual(quoteToken, getAddress(NATIVE_TOKEN)) ? "ETH" : "Quote token")),
      fee: leg.fee && /^\d+$/.test(leg.fee) ? Number(leg.fee) : null,
      liquidityRaw: leg.liquidity && /^\d+$/.test(leg.liquidity) ? leg.liquidity : null,
    }];
  });
  return candidates[0] ?? null;
}

export async function discoverDirectUniswapMarket(
  chain: ChainKey,
  token: Address,
  decimals: number,
): Promise<DirectUniswapMarketCheck> {
  if (chain !== "base") return { status: "not-found", market: null };
  const key = `${chain}:${token.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const apiKey = process.env.UNISWAP_API_KEY?.trim();
  const swapper = process.env.UNISWAP_FEE_RECIPIENT?.trim();
  if (!apiKey || !swapper || !isAddress(swapper)) return { status: "unavailable", market: null };
  const oneToken = 10n ** BigInt(Math.min(Math.max(decimals, 0), 36));
  const amounts = [oneToken, oneToken * 1_000n, oneToken * 100_000n];

  try {
    for (const amount of amounts) {
      const response = await fetch(`${UNISWAP_API}/quote`, {
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": apiKey,
          "x-permit2-disabled": "true",
        },
        body: JSON.stringify({
          tokenIn: token,
          tokenOut: NATIVE_TOKEN,
          tokenInChainId: CHAINS.base.id,
          tokenOutChainId: CHAINS.base.id,
          type: "EXACT_INPUT",
          amount: amount.toString(),
          swapper,
          recipient: swapper,
          slippageTolerance: 0.5,
          routingPreference: "BEST_PRICE",
          protocols: ["V2", "V3", "V4"],
        }),
      });
      if (response.status === 404) continue;
      if (!response.ok) return { status: "unavailable", market: null };
      const payload = await response.json() as { routing?: string; quote?: { route?: unknown } };
      if (payload.routing !== "CLASSIC") return { status: "unavailable", market: null };
      const market = parseIndependentPoolRoute(payload.quote?.route, token);
      if (!market) return { status: "unavailable", market: null };
      const value = { status: "found", market } as const;
      cache.set(key, { expiresAt: Date.now() + CACHE_MS, value });
      return value;
    }
    const value = { status: "not-found", market: null } as const;
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, value });
    return value;
  } catch {
    return { status: "unavailable", market: null };
  }
}
