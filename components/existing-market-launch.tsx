"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, ShieldCheck } from "lucide-react";
import { isAddress } from "viem";
import { LaunchLiquidity } from "@/components/launch-liquidity";
import { readManifests, saveManifest } from "@/lib/manifest";
import type { VerifiedMarket } from "@/lib/onchain-types";
import type { LaunchManifest, TokenAnalysis } from "@/lib/types";

function manifestFrom(market: VerifiedMarket, analysis: TokenAnalysis): LaunchManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    stage: "token-created",
    chain: market.chain,
    owner: null,
    input: {
      backingToken: market.reserveToken,
      hypedName: market.name,
      hypedSymbol: market.symbol,
    },
    analysis,
    configuration: null,
    liquidity: null,
    execution: {
      txs: {},
      hypedToken: market.token,
      pool: null,
      lpTokenId: null,
    },
    provenance: {
      analysisBlock: analysis.blockNumber,
      quoteExpiresAt: null,
      policyVersion: "2026-08.1",
    },
  };
}

export function ExistingMarketLaunch({ token }: { token: string }) {
  const validToken = isAddress(token);
  const [market, setMarket] = useState<VerifiedMarket | null>(null);
  const [manifest, setManifest] = useState<LaunchManifest | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!validToken) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const marketResponse = await fetch(`/api/market?chain=base&address=${token}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const marketPayload = await marketResponse.json() as { markets?: VerifiedMarket[]; error?: string };
        const nextMarket = marketPayload.markets?.find((item) => item.chain === "base");
        if (!marketResponse.ok || !nextMarket) throw new Error(marketPayload.error ?? "The Hyped Token was not found on Base.");
        setMarket(nextMarket);
        if (nextMarket.directMarket) return;

        const analysisResponse = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokenAddress: nextMarket.reserveToken }),
          signal: controller.signal,
        });
        const analysisPayload = await analysisResponse.json() as { analyses?: TokenAnalysis[]; error?: string };
        const analysis = analysisPayload.analyses?.find((item) => item.chain === "base");
        if (!analysisResponse.ok || !analysis) throw new Error(analysisPayload.error ?? "The OG token could not be verified on Base.");

        const existingManifest = readManifests().find((item) => (
          item.chain === "base"
          && item.execution.hypedToken?.toLowerCase() === nextMarket.token.toLowerCase()
          && item.owner === null
        ));
        const nextManifest = existingManifest ?? saveManifest(manifestFrom(nextMarket, analysis));
        setManifest(nextManifest);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "The pool setup failed.");
        }
      }
    })();
    return () => controller.abort();
  }, [token, validToken]);

  if (!validToken) return <div className="empty-state page-shell"><ShieldCheck /><h1>Pool setup unavailable.</h1><p>Enter this flow from a verified Base Hyped Token market.</p><Link className="primary-link" href="/markets">Back to markets</Link></div>;
  if (error) return <div className="empty-state page-shell"><ShieldCheck /><h1>Pool setup unavailable.</h1><p>{error}</p><Link className="primary-link" href="/markets">Back to markets</Link></div>;
  if (!market) return <div className="empty-state page-shell"><LoaderCircle className="spin" /><h1>Reading the Hyped Token</h1><p>Only confirmed Base contracts are used.</p></div>;
  if (market.directMarket) return <div className="empty-state page-shell"><ShieldCheck /><h1>{market.symbol} already has a market.</h1><p>An active Uniswap {market.directMarket.protocol} {market.symbol} / {market.directMarket.quoteSymbol} market was confirmed on Base.</p><Link className="primary-link" href={`/market/base/${market.token}`}>Open market</Link></div>;
  if (!manifest) return <div className="empty-state page-shell"><LoaderCircle className="spin" /><h1>Preparing liquidity</h1><p>The OG token and pool inputs are being verified.</p></div>;

  return (
    <div className="inner-page page-shell">
      <Link href={`/market/base/${market.token}`} className="back-link"><ArrowLeft /> Back to {market.symbol}</Link>
      <div className="page-title">
        <span className="kicker">Complete the arbitrage loop</span>
        <h1>Create the {market.symbol} market.</h1>
        <p>Mint real {market.symbol}, pair it with WETH, and receive the Uniswap position directly in your wallet.</p>
      </div>
      <LaunchLiquidity manifest={manifest} onChange={setManifest} onComplete={() => undefined} />
    </div>
  );
}
