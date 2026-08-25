import { MarketsBrowser } from "@/components/markets-browser";
import type { ChainKey } from "@/lib/chains";
import { readVerifiedMarkets } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const chains: ChainKey[] = ["base", "robinhood"];
  const results = await Promise.allSettled([
    readVerifiedMarkets("base"),
    readVerifiedMarkets("robinhood"),
  ]);
  const markets = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const unavailableChains = chains.filter((_, index) => results[index].status === "rejected");
  return <MarketsBrowser initial={markets} unavailableChains={unavailableChains} />;
}
