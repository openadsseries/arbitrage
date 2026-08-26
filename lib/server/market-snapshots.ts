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

async function comparisonForMarket(
  market: VerifiedMarket,
  readiness: ArbitrageMarketReadiness | null,
): Promise<MarketComparisonState> {
  if (market.chain !== "base" || !readiness) {
    return { status: "unavailable", reason: "markets-not-ready" };
  }
  return readMarketComparison({
    chain: market.chain,
    og: readiness.originalMarket.pool
      ? { token: market.reserveToken, pool: readiness.originalMarket.pool }
      : null,
    hyped: readiness.hypedMarket.pool
      ? { token: market.token, pool: readiness.hypedMarket.pool }
      : null,
  });
}

export async function readFreshMarketComparison(chain: ChainKey, inputAddress: string) {
  const market = await readVerifiedMarket(chain, getAddress(inputAddress) as Address);
  if (!market) return null;
  const readiness = await readArbitrageMarketReadinessForMarket(market).catch(() => null);
  return comparisonForMarket(market, readiness);
}

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

const readMarketDetailCore = unstable_cache(
  async (chain: ChainKey, inputAddress: string) => {
    const address = getAddress(inputAddress) as Address;
    const market = await readVerifiedMarket(chain, address);
    if (!market) return null;

    if (chain !== "base") {
      return {
        market,
        arbitrageReadiness: null,
        initialOpportunity: null,
      };
    }

    const arbitrageReadiness = await readArbitrageMarketReadinessForMarket(market).catch(() => null);
    const initialOpportunity = await readArbitrageOpportunityForMarket(
      market,
      10n ** BigInt(market.reserveDecimals),
    ).catch(() => null);

    return { market, arbitrageReadiness, initialOpportunity };
  },
  ["market-detail-core-v3"],
  { revalidate: 15 },
);

export async function readMarketDetailSnapshot(
  chain: ChainKey,
  inputAddress: string,
): Promise<MarketDetailSnapshot | null> {
  const core = await readMarketDetailCore(chain, inputAddress);
  if (!core) return null;
  const marketComparison = await comparisonForMarket(core.market, core.arbitrageReadiness);
  return { ...core, marketComparison };
}
