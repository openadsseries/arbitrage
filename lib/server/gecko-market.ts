import "server-only";

import type { Address, Hex } from "viem";
import type { ChainKey } from "@/lib/chains";

const GECKO_ROOT = "https://api.geckoterminal.com/api/v2";
const GECKO_HEADERS = {
  accept: "application/json",
  version: "20230302",
};

type GeckoPool = {
  attributes?: {
    address?: string;
    base_token_price_usd?: string | null;
    quote_token_price_usd?: string | null;
    reserve_in_usd?: string | null;
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
};

type PoolResponse = { data?: GeckoPool[] };

export type TokenMarketPrice = {
  usd: number;
  liquidityUsd: number;
  sourcePool: Hex;
  sourceUrl: string;
  checkedAt: string;
};

function tokenFromRelationship(id: string | undefined) {
  const separator = id?.indexOf("_") ?? -1;
  return separator < 0 ? null : id?.slice(separator + 1).toLowerCase() ?? null;
}

function positiveNumber(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Reads the selected token's USD price from GeckoTerminal's highest-ranked
 * pool. The exact pool is retained so every derived USD value is attributable.
 */
export async function readTokenMarketPrice(
  chain: ChainKey,
  token: Address,
  options: { fresh?: boolean } = {},
): Promise<TokenMarketPrice | null> {
  try {
    const tokenAddress = token.toLowerCase();
    const response = await fetch(`${GECKO_ROOT}/networks/${chain}/tokens/${tokenAddress}/pools?page=1`, {
      headers: GECKO_HEADERS,
      ...(options.fresh ? { cache: "no-store" as const } : { next: { revalidate: 600 } }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as PoolResponse;
    const candidates = (payload.data ?? []).flatMap((pool) => {
      const poolAddress = pool.attributes?.address;
      if (!poolAddress || !/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(poolAddress)) return [];
      const isBase = tokenFromRelationship(pool.relationships?.base_token?.data?.id) === tokenAddress;
      const isQuote = tokenFromRelationship(pool.relationships?.quote_token?.data?.id) === tokenAddress;
      const usd = isBase
        ? positiveNumber(pool.attributes?.base_token_price_usd)
        : isQuote
          ? positiveNumber(pool.attributes?.quote_token_price_usd)
          : null;
      const liquidityUsd = positiveNumber(pool.attributes?.reserve_in_usd);
      if (usd === null || liquidityUsd === null) return [];
      return [{
        usd,
        liquidityUsd,
        sourcePool: poolAddress as Hex,
        sourceUrl: `https://www.geckoterminal.com/${chain}/pools/${poolAddress}`,
        checkedAt: new Date().toISOString(),
      }];
    });
    return candidates.sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0] ?? null;
  } catch {
    return null;
  }
}
