import type { ChainKey } from "@/lib/chains";

export type TrendingToken = {
  chain: ChainKey;
  address: `0x${string}`;
  name: string;
  symbol: string;
  imageUrl: string | null;
  priceChange24h: number | null;
};
