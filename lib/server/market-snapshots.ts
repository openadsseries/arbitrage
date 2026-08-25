import "server-only";

import { unstable_cache } from "next/cache";
import { getAddress, type Address } from "viem";
import type { ArbitrageMarketReadiness, ArbitrageOpportunity } from "@/lib/arbitrage";
import type { ChainKey } from "@/lib/chains";
import type { VerifiedMarket } from "@/lib/onchain-types";
import { readArbitrageMarketReadinessForMarket } from "@/lib/server/arbitrage";
import { readArbitrageOpportunityForMarket } from "@/lib/server/arbitrage-opportunity";
import { readMarketComparison, type MarketComparisonState } from "@/lib/server/gecko-comparison";
import { readVerifiedMarket, readVerifiedMarkets } from "@/lib/server/markets";

export const MARKET_CHAINS: ChainKey[] = ["base", "robinhood"];

export type MarketsSnapshot = {
  markets: VerifiedMarket[];
  unavailableChains: ChainKey[];
};

export type MarketDetailSnapshot = {
  market: VerifiedMarket;
  arbitrageReadiness: ArbitrageMarketReadiness | null;
  marketComparison: MarketComparisonState;
  initialOpportunity: ArbitrageOpportunity | null;
};

export const readMarketsSnapshot = unstable_cache(
  async (): Promise<MarketsSnapshot> => {
    const results = await Promise.allSettled(MARKET_CHAINS.map((chain) => readVerifiedMarkets(chain)));
    return {
      markets: results.flatMap((result) => result.status === "fulfilled" ? result.value : []),
      unavailableChains: MARKET_CHAINS.filter((_, index) => results[index].status === "rejected"),
    };
  },
  ["markets-snapshot-v2"],
  { revalidate: 30 },
);

export const readMarketDetailSnapshot = unstable_cache(
  async (chain: ChainKey, inputAddress: string): Promise<MarketDetailSnapshot | null> => {
    const address = getAddress(inputAddress) as Address;
    const market = await readVerifiedMarket(chain, address);
    if (!market) return null;

    if (chain !== "base") {
      return {
        market,
        arbitrageReadiness: null,
        marketComparison: { status: "unavailable", reason: "markets-not-ready" },
        initialOpportunity: null,
      };
    }

    const arbitrageReadiness = await readArbitrageMarketReadinessForMarket(market).catch(() => null);
    const [marketComparison, initialOpportunity] = await Promise.all([
      arbitrageReadiness ? readMarketComparison({
        chain,
        og: arbitrageReadiness.originalMarket.pool
          ? { token: market.reserveToken, pool: arbitrageReadiness.originalMarket.pool }
          : null,
        hyped: arbitrageReadiness.hypedMarket.pool
          ? { token: market.token, pool: arbitrageReadiness.hypedMarket.pool }
          : null,
      }) : Promise.resolve({ status: "unavailable" as const, reason: "markets-not-ready" as const }),
      readArbitrageOpportunityForMarket(market, 10n ** BigInt(market.reserveDecimals)).catch(() => null),
    ]);

    return { market, arbitrageReadiness, marketComparison, initialOpportunity };
  },
  ["market-detail-v2"],
  { revalidate: 15 },
);
