import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAddress } from "viem";
import { MarketDetailLoader } from "@/components/market-detail-loader";
import type { ChainKey } from "@/lib/chains";

export default async function MarketDetailPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const input = await params;
  if (input.chain !== "base" && input.chain !== "robinhood") notFound();
  let address;
  try { address = getAddress(input.address); } catch { notFound(); }
  const chainKey = input.chain as ChainKey;
  return (
    <div className="inner-page page-shell market-detail-page">
      <Link href="/markets" className="back-link"><ArrowLeft /> Markets</Link>
      <MarketDetailLoader chain={chainKey} address={address} />
    </div>
  );
}
