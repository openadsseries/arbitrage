"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import type { Address } from "viem";
import { MarketAssetDetail } from "@/components/market-asset-detail";
import type { ArbitrageMarketReadiness } from "@/lib/arbitrage";
import type { ChainKey } from "@/lib/chains";
import type { VerifiedMarket } from "@/lib/onchain-types";
import type { MarketComparisonState } from "@/lib/server/gecko-comparison";

type DetailPayload = {
  market: VerifiedMarket;
  arbitrageReadiness: ArbitrageMarketReadiness | null;
  marketComparison: MarketComparisonState;
};

export function MarketDetailLoader({ chain, address }: { chain: ChainKey; address: Address }) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/market/detail?chain=${chain}&address=${address}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as Partial<DetailPayload> & { error?: string };
        if (!response.ok || !payload.market || !("marketComparison" in payload)) {
          throw new Error(payload.error ?? "Market not found.");
        }
        setDetail({
          market: payload.market,
          arbitrageReadiness: payload.arbitrageReadiness ?? null,
          marketComparison: payload.marketComparison as MarketComparisonState,
        });
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Could not read this market.");
        }
      });
    return () => controller.abort();
  }, [address, chain]);

  if (detail) return <MarketAssetDetail {...detail} />;

  if (error) {
    return (
      <div className="empty-state compact market-detail-state">
        <ShieldCheck />
        <h1>Market unavailable.</h1>
        <p>{error}</p>
        <Link className="primary-link" href="/markets">Back to markets</Link>
      </div>
    );
  }

  return (
    <div className="market-detail-loading" aria-live="polite">
      <LoaderCircle className="spin" />
      <div>
        <span className="kicker">Loading market</span>
        <h1>Preparing the arbitrage view.</h1>
      </div>
    </div>
  );
}
