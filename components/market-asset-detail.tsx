"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { parseUnits } from "viem";
import { ArbitragePriceGap } from "@/components/arbitrage-price-gap";
import { MarketArbitrageHistory } from "@/components/market-arbitrage-history";
import { MarketAutomationPanel } from "@/components/market-automation-panel";
import { OgSwapPanel } from "@/components/og-swap-panel";
import { QuickBuyPanel } from "@/components/quick-buy-panel";
import { tokenLogoUrl } from "@/components/token-logo";
import { CHAINS } from "@/lib/chains";
import type { ArbitrageMarketReadiness, ReserveArbitrageExecution } from "@/lib/arbitrage";
import type { MarketAssetKind, VerifiedMarket } from "@/lib/onchain-types";
import type { MarketComparisonState } from "@/lib/server/gecko-comparison";

function geckoUrl(network: string, token: string, embed = false) {
  const url = new URL(`https://www.geckoterminal.com/${network}/tokens/${token}`);
  if (!embed) return url.toString();
  url.searchParams.set("embed", "1");
  url.searchParams.set("info", "0");
  url.searchParams.set("swaps", "0");
  url.searchParams.set("light_chart", "0");
  url.searchParams.set("chart_type", "price");
  url.searchParams.set("resolution", "1d");
  url.searchParams.set("bg_color", "151315");
  return url.toString();
}

export function MarketAssetDetail({
  market,
  arbitrageReadiness,
  marketComparison,
}: {
  market: VerifiedMarket;
  arbitrageReadiness: ArbitrageMarketReadiness | null;
  marketComparison: MarketComparisonState;
}) {
  const chain = CHAINS[market.chain];
  const [view, setView] = useState<"arbitrage" | MarketAssetKind>("arbitrage");
  const [latestExecution, setLatestExecution] = useState<ReserveArbitrageExecution | null>(null);
  const [estimatedProfitRaw, setEstimatedProfitRaw] = useState<string | null>(null);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [arbitrageBudget, setArbitrageBudget] = useState("1");
  const [activeArbitrageAmountRaw, setActiveArbitrageAmountRaw] = useState<string | null>(null);
  const [activeWatchReason, setActiveWatchReason] = useState("");
  const arbitrageBudgetRaw = useMemo(() => {
    try {
      const value = parseUnits(arbitrageBudget, market.reserveDecimals);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [arbitrageBudget, market.reserveDecimals]);
  const quoteBudgetRaw = activeArbitrageAmountRaw ? BigInt(activeArbitrageAmountRaw) : arbitrageBudgetRaw;
  const asset: MarketAssetKind = view === "og" ? "og" : "hyped";

  const selected = asset === "og" ? {
    address: market.reserveToken,
    name: market.reserveName,
    symbol: market.reserveSymbol,
    type: "OG token",
  } : {
    address: market.token,
    name: market.name,
    symbol: market.symbol,
    type: "Hyped Token",
  };
  const chartUrl = geckoUrl(market.chain, selected.address, true);
  const sourceUrl = geckoUrl(market.chain, selected.address);
  const marketsConnected = Boolean(arbitrageReadiness?.originalMarket.ready && arbitrageReadiness?.hypedMarket.ready);

  return (
    <>
      <header className="market-pair-head">
        <div className="market-pair-title">
          <div className="market-pair-logos" aria-hidden="true">
            <Image src={tokenLogoUrl(market.reserveToken, chain.id)} alt="" width={46} height={46} loading="eager" unoptimized />
            <Image src={tokenLogoUrl(market.token, chain.id)} alt="" width={46} height={46} loading="eager" unoptimized />
          </div>
          <div>
            <h1>{market.reserveSymbol} ↔ {market.symbol}</h1>
          </div>
        </div>
        <div className="market-view-select" role="tablist" aria-label="Market view">
          <button aria-selected={view === "arbitrage"} className={view === "arbitrage" ? "selected" : ""} onClick={() => setView("arbitrage")} role="tab" type="button">Arbitrage</button>
          <button aria-selected={view === "og"} className={view === "og" ? "selected" : ""} onClick={() => setView("og")} role="tab" type="button">
            <Image src={tokenLogoUrl(market.reserveToken, chain.id)} alt="" width={18} height={18} unoptimized />
            {market.reserveSymbol}
          </button>
          <button aria-selected={view === "hyped"} className={view === "hyped" ? "selected" : ""} onClick={() => setView("hyped")} role="tab" type="button">
            <Image src={tokenLogoUrl(market.token, chain.id)} alt="" width={18} height={18} unoptimized />
            {market.symbol}
          </button>
        </div>
      </header>

      {view === "arbitrage" && (
        <>
          <section className="arbitrage-focus market-workspace-face" aria-label={`${market.symbol} arbitrage`}>
            <div className="arbitrage-story">
              {marketsConnected
                ? <ArbitragePriceGap
                    market={market}
                    checkedAmountRaw={quoteBudgetRaw}
                    marketComparison={marketComparison}
                    onEstimatedProfitChange={setEstimatedProfitRaw}
                    watchReason={activeArbitrageAmountRaw ? activeWatchReason : ""}
                  />
                : <div className="price-gap-view"><div className="price-gap-heading"><span className="kicker">Live quote</span><h2>Both markets are required.</h2><p>GETHYPED needs an executable price for both tokens before it can compare them.</p></div></div>}
            </div>
            <aside className="arbitrage-action">
              <MarketAutomationPanel
                market={market}
                initialReadiness={arbitrageReadiness}
                onExecutionChange={setLatestExecution}
                onPositionChange={() => setHistoryRefreshToken((value) => value + 1)}
                onActiveAmountChange={setActiveArbitrageAmountRaw}
                onWatchReasonChange={setActiveWatchReason}
                budget={arbitrageBudget}
                budgetRaw={arbitrageBudgetRaw}
                onBudgetChange={setArbitrageBudget}
                estimatedProfitRaw={estimatedProfitRaw}
              />
            </aside>
          </section>
          <MarketArbitrageHistory market={market} latestExecution={latestExecution} refreshSignal={historyRefreshToken} />
        </>
      )}

      {view !== "arbitrage" && <section key={`trade-${asset}`} className="market-price-section with-trade market-workspace-face" aria-label={`Trade ${selected.symbol}`}>
        <div className="market-price-head">
          <div className="market-trade-title">
            <Image src={tokenLogoUrl(selected.address, chain.id)} alt="" width={38} height={38} unoptimized />
            <div>
              <span className="kicker">{selected.type}</span>
              <h2>Trade {selected.symbol}</h2>
              <p>Live price on the left. Buy or sell on the right.</p>
            </div>
          </div>
        </div>
        <div className="market-context-body">
          <section className="market-embed-section" aria-label={`${selected.symbol} live market chart`}>
            <div className="market-embed-bar">
              <span>{selected.symbol} live market</span>
              <a href={sourceUrl} target="_blank" rel="noreferrer">Open on GeckoTerminal <ExternalLink /></a>
            </div>
            <div className="market-embed-frame">
              <iframe
                key={chartUrl}
                title={`${selected.symbol} live chart by GeckoTerminal`}
                src={chartUrl}
                allow="clipboard-write; fullscreen"
                allowFullScreen
              />
            </div>
          </section>
          <aside className="market-buy-column" aria-label={`Trade ${selected.symbol}`}>
            {asset === "og" ? <OgSwapPanel market={market} embedded /> : <QuickBuyPanel market={market} embedded />}
          </aside>
        </div>
      </section>}
    </>
  );
}
