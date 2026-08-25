import "server-only";

import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { CHAINS, type ChainKey } from "@/lib/chains";
import type { TrendingToken } from "@/lib/trending";

const tokenSchema = z.object({
  id: z.string(),
  type: z.literal("token"),
  attributes: z.object({
    address: z.string(),
    name: z.string(),
    symbol: z.string(),
    image_url: z.string().url().nullable().optional(),
  }),
});

const poolSchema = z.object({
  attributes: z.object({
    price_change_percentage: z.object({ h24: z.string().nullable().optional() }).passthrough().optional(),
  }).passthrough(),
  relationships: z.object({
    base_token: z.object({ data: z.object({ id: z.string() }) }),
    quote_token: z.object({ data: z.object({ id: z.string() }) }),
  }),
});

const responseSchema = z.object({
  data: z.array(poolSchema),
  included: z.array(tokenSchema).default([]),
});

function isQuoteAsset(chain: ChainKey, address: string) {
  return CHAINS[chain].quoteAssets.some((asset) => asset.address.toLowerCase() === address.toLowerCase());
}

function safeImageUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  const trustedHosts = new Set(["coin-images.coingecko.com", "assets.geckoterminal.com"]);
  return trustedHosts.has(url.hostname) ? url.toString() : null;
}

async function readChainTrending(chain: ChainKey): Promise<TrendingToken[]> {
  const response = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/${chain}/trending_pools?include=base_token,quote_token&duration=24h&page=1`,
    {
      headers: { accept: "application/json" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error(`Trending read failed for ${chain}.`);

  const payload = responseSchema.parse(await response.json());
  const tokens = new Map(payload.included.map((token) => [token.id, token.attributes]));
  const seen = new Set<string>();
  const result: TrendingToken[] = [];

  for (const pool of payload.data) {
    const base = tokens.get(pool.relationships.base_token.data.id);
    const quote = tokens.get(pool.relationships.quote_token.data.id);
    const candidate = base && !isQuoteAsset(chain, base.address) ? base : quote;
    if (!candidate || !isAddress(candidate.address) || isQuoteAsset(chain, candidate.address)) continue;

    const address = getAddress(candidate.address);
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const change = Number(pool.attributes.price_change_percentage?.h24);
    result.push({
      chain,
      address,
      name: candidate.name,
      symbol: candidate.symbol,
      imageUrl: safeImageUrl(candidate.image_url),
      priceChange24h: Number.isFinite(change) ? change : null,
    });
    if (result.length === 4) break;
  }

  return result;
}

export async function getTrendingTokens(): Promise<TrendingToken[]> {
  const reads = await Promise.allSettled([
    readChainTrending("base"),
    readChainTrending("robinhood"),
  ]);
  const base = reads[0].status === "fulfilled" ? reads[0].value : [];
  const robinhood = reads[1].status === "fulfilled" ? reads[1].value : [];
  const combined: TrendingToken[] = [];

  for (let index = 0; index < Math.max(base.length, robinhood.length); index += 1) {
    if (base[index]) combined.push(base[index]);
    if (robinhood[index]) combined.push(robinhood[index]);
  }

  return combined;
}
