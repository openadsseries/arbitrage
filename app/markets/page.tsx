import { MarketsBrowser } from "@/components/markets-browser";
import { readMarketsSnapshot, type MarketsSnapshot } from "@/lib/server/market-snapshots";

export default async function MarketsPage() {
  let snapshot: MarketsSnapshot = { markets: [], unavailableChains: [] };
  let initialError = "";
  try {
    snapshot = await readMarketsSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Could not read markets.";
  }
  return <MarketsBrowser initial={snapshot.markets} unavailableChains={snapshot.unavailableChains} initialError={initialError} />;
}
