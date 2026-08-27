import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAddress } from "viem";
import { MarketAssetDetail } from "@/components/market-asset-detail";
import type { ChainKey } from "@/lib/chains";
import { readMarketDetailSnapshot } from "@/lib/server/market-snapshots";

export default async function MarketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ chain: string; address: string }>;
  searchParams: Promise<{ amountRaw?: string | string[] }>;
}) {
  const [input, query] = await Promise.all([params, searchParams]);
  if (input.chain !== "base" && input.chain !== "robinhood") notFound();
  let address;
  try { address = getAddress(input.address); } catch { notFound(); }
  const chainKey = input.chain as ChainKey;
  const detail = await readMarketDetailSnapshot(chainKey, address);
  if (!detail) notFound();
  const benchmarkAmountRaw = 10n ** BigInt(detail.market.reserveDecimals);
  const requestedAmountRaw = Array.isArray(query.amountRaw)
    ? query.amountRaw[0]
    : query.amountRaw;
  const initialAmountRaw =
    requestedAmountRaw && /^\d+$/.test(requestedAmountRaw) &&
    BigInt(requestedAmountRaw) === benchmarkAmountRaw
      ? requestedAmountRaw
      : benchmarkAmountRaw.toString();
  return (
    <div className="inner-page page-shell market-detail-page">
      <Link href="/markets" className="back-link"><ArrowLeft /> Markets</Link>
      <MarketAssetDetail {...detail} initialAmountRaw={initialAmountRaw} />
    </div>
  );
}
