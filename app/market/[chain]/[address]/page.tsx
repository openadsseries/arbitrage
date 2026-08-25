import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAddress } from "viem";
import { MarketAssetDetail } from "@/components/market-asset-detail";
import type { ChainKey } from "@/lib/chains";
import { readArbitrageMarketReadiness } from "@/lib/server/arbitrage";
import { readMarketComparison } from "@/lib/server/gecko-comparison";
import { readVerifiedMarket } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

export default async function MarketDetailPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const input = await params;
  if (input.chain !== "base" && input.chain !== "robinhood") notFound();
  let address;
  try { address = getAddress(input.address); } catch { notFound(); }
  const chainKey = input.chain as ChainKey;
  const market = await readVerifiedMarket(chainKey, address);
  if (!market) notFound();
  const arbitrageReadiness = chainKey === "base"
    ? await readArbitrageMarketReadiness(chainKey, market.token).catch(() => null)
    : null;
  const marketComparison = arbitrageReadiness
    ? await readMarketComparison({
      chain: chainKey,
      og: arbitrageReadiness.originalMarket.pool
        ? { token: market.reserveToken, pool: arbitrageReadiness.originalMarket.pool }
        : null,
      hyped: arbitrageReadiness.hypedMarket.pool
        ? { token: market.token, pool: arbitrageReadiness.hypedMarket.pool }
        : null,
    })
    : { status: "unavailable" as const, reason: "markets-not-ready" as const };
  return (
    <div className="inner-page page-shell market-detail-page">
      <Link href="/markets" className="back-link"><ArrowLeft /> Markets</Link>
      <MarketAssetDetail market={market} arbitrageReadiness={arbitrageReadiness} marketComparison={marketComparison} />
    </div>
  );
}
