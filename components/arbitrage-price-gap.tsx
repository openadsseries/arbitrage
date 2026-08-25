"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";
import { tokenLogoUrl } from "@/components/token-logo";
import {
  type ArbitrageOpportunity,
  type ArbitrageOpportunityRoute,
  type ReserveArbitrageExecution,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import type { VerifiedMarket } from "@/lib/onchain-types";
import type { MarketComparisonState } from "@/lib/server/gecko-comparison";

function displayReserve(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function routeTokens(route: ArbitrageOpportunityRoute, market: VerifiedMarket) {
  return route.direction === "Mint then sell"
    ? [market.reserveSymbol, market.symbol, market.reserveSymbol]
    : [market.reserveSymbol, market.symbol, market.reserveSymbol];
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1000));
}

function HistoricalPriceChart({ comparison, market }: { comparison: MarketComparisonState; market: VerifiedMarket }) {
  if (comparison.status !== "ready") return (
    <div className="price-history-unavailable">
      <strong>Price history is not available yet.</strong>
      <span>The live result above still uses current onchain prices.</span>
    </div>
  );

  const chain = CHAINS[market.chain];
  const points = comparison.data.points;
  const width = 800;
  const height = 270;
  const left = 18;
  const right = 18;
  const top = 22;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = points.flatMap((point) => [point.og, point.hyped]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(3, (rawMax - rawMin) * 0.12);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const first = points[0].timestamp;
  const last = points.at(-1)?.timestamp ?? first;
  const x = (timestamp: number) => left + (timestamp - first) / (last - first || 1) * plotWidth;
  const y = (value: number) => top + (max - value) / (max - min || 1) * plotHeight;
  const line = (key: "og" | "hyped") => points.map((point) => `${x(point.timestamp)},${y(point[key])}`).join(" ");

  return (
    <figure className="price-history-chart" aria-label={`Historical price movement for ${market.reserveSymbol} and ${market.symbol}`}>
      <figcaption>
        <span>How the two prices moved</span>
        <small>When the lines move apart, we check whether the price gap still pays after costs.</small>
      </figcaption>
      <div className="price-history-legend">
        <span><i className="og" /><Image src={tokenLogoUrl(market.reserveToken, chain.id)} alt="" width={22} height={22} unoptimized /><b>{market.reserveSymbol}</b></span>
        <span className="hyped"><i /><Image src={tokenLogoUrl(market.token, chain.id)} alt="" width={22} height={22} unoptimized /><b>{market.symbol}</b></span>
      </div>
      <div className="price-history-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          {[top, top + plotHeight / 2, height - bottom].map((lineY) => <line className="price-history-grid" x1={left} x2={width - right} y1={lineY} y2={lineY} key={lineY} />)}
          <polyline className="price-history-line og" points={line("og")} />
          <polyline className="price-history-line hyped" points={line("hyped")} />
          <text className="price-history-axis" x={left} y={height - 8}>{formatDate(comparison.data.firstObserved)}</text>
          <text className="price-history-axis" x={width - right} y={height - 8} textAnchor="end">{formatDate(comparison.data.lastObserved)}</text>
        </svg>
      </div>
    </figure>
  );
}

export function ArbitragePriceGap({
  market,
  marketComparison,
  latestExecution,
  checkedAmountRaw,
  onEstimatedProfitChange,
}: {
  market: VerifiedMarket;
  marketComparison: MarketComparisonState;
  latestExecution: ReserveArbitrageExecution | null;
  checkedAmountRaw: bigint | null;
  onEstimatedProfitChange?: (raw: string | null) => void;
}) {
  const [opportunity, setOpportunity] = useState<ArbitrageOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const opportunityRef = useRef<ArbitrageOpportunity | null>(null);
  const [quotedAmountRaw, setQuotedAmountRaw] = useState<bigint | null>(checkedAmountRaw);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setQuotedAmountRaw(checkedAmountRaw),
      checkedAmountRaw === null ? 0 : 400,
    );
    return () => window.clearTimeout(timer);
  }, [checkedAmountRaw]);

  useEffect(() => {
    if (quotedAmountRaw === null) {
      const timer = window.setTimeout(() => {
        opportunityRef.current = null;
        setOpportunity(null);
        setError("");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let active = true;
    let controller: AbortController | null = null;
    const read = async (initial = false) => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      if (initial) {
        opportunityRef.current = null;
        setOpportunity(null);
        setError("");
        setLoading(true);
      }
      fetch(`/api/arbitrage/opportunity?token=${market.token}&amountRaw=${quotedAmountRaw}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await response.json() as { opportunity?: ArbitrageOpportunity; error?: string };
          if (!response.ok || !payload.opportunity) throw new Error(payload.error ?? "The price gap could not be checked.");
          if (!active) return;
          opportunityRef.current = payload.opportunity;
          setOpportunity(payload.opportunity);
          setError("");
        })
        .catch((reason) => {
          if (active && !(reason instanceof DOMException && reason.name === "AbortError")) {
            if (!opportunityRef.current) setOpportunity(null);
            setError(reason instanceof Error ? reason.message : "The price gap could not be checked.");
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    void read(true);
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      controller?.abort();
    };
  }, [market.token, quotedAmountRaw]);

  const route = useMemo(() => {
    if (!opportunity) return null;
    return [...opportunity.routes].sort((left, right) => {
      const a = BigInt(left.ownerDifferenceRaw);
      const b = BigInt(right.ownerDifferenceRaw);
      return a === b ? 0 : a > b ? -1 : 1;
    })[0] ?? null;
  }, [opportunity]);
  const netPositive = Boolean(route && (route.netPositive ?? route.profitable));
  const chain = CHAINS[market.chain];
  const tokens = route ? routeTokens(route, market) : [];
  const ownerReturnRaw = route
    ? (BigInt(route.amountInRaw) + BigInt(route.ownerDifferenceRaw)).toString()
    : null;

  useEffect(() => {
    onEstimatedProfitChange?.(netPositive && route ? route.ownerDifferenceRaw : null);
  }, [netPositive, onEstimatedProfitChange, route]);

  return (
    <div className="price-gap-view">
      <div className="price-gap-heading">
        <span className="kicker">1 · Check profit</span>
        <h2>
          <strong>{loading
            ? "Checking prices"
            : quotedAmountRaw === null
              ? "Enter a budget"
            : netPositive && route
              ? `+${((route.netReturnBps ?? route.gapBps) / 100).toFixed(2)}% profit opportunity`
              : "No profit right now"}</strong>
        </h2>
      </div>

      <HistoricalPriceChart comparison={marketComparison} market={market} />

      {route && <>
        <div className="price-gap-route-wrap">
          <span>Best quoted route</span>
          <div className="price-gap-route" aria-label={`Best quoted route: ${tokens.join(" to ")}`}>
            {tokens.map((token, index) => <Fragment key={`${token}-${index}`}>
              <span className={`${token === market.symbol ? "hyped" : ""} ${index === 0 || index === tokens.length - 1 ? "endpoint" : ""}`}>
                {index === 0 && <><small>Use</small><b>{displayReserve(route.amountInRaw, opportunity?.reserveDecimals ?? market.reserveDecimals)} {market.reserveSymbol}</b></>}
                {index > 0 && index < tokens.length - 1 && <>
                  {token === market.reserveSymbol && <Image src={tokenLogoUrl(market.reserveToken, chain.id)} alt="" width={26} height={26} unoptimized />}
                  {token === market.symbol && <Image src={tokenLogoUrl(market.token, chain.id)} alt="" width={26} height={26} unoptimized />}
                  <b>{token}</b>
                </>}
                {index === tokens.length - 1 && ownerReturnRaw && <><small>Your return</small><b>{displayReserve(ownerReturnRaw, opportunity?.reserveDecimals ?? market.reserveDecimals)} {market.reserveSymbol}</b></>}
              </span>
              {index < tokens.length - 1 && <ArrowRight />}
            </Fragment>)}
          </div>
        </div>
      </>}

      {latestExecution && (
        <a className="arbitrage-execution-result" href={`${chain.explorerUrl}/tx/${latestExecution.transactionHash}`} target="_blank" rel="noreferrer">
          <span>Latest execution</span>
          <dl>
            <div><dt>Used</dt><dd>{displayReserve(latestExecution.amountInReserveRaw, market.reserveDecimals)} {market.reserveSymbol}</dd></div>
            <div><dt>Returned</dt><dd>{displayReserve(latestExecution.amountReturnedReserveRaw, market.reserveDecimals)} {market.reserveSymbol}</dd></div>
            <div><dt>Your profit</dt><dd>+{displayReserve(latestExecution.ownerProfitReserveRaw, market.reserveDecimals)} {market.reserveSymbol}</dd></div>
          </dl>
          <ExternalLink aria-hidden="true" />
        </a>
      )}

      {error && <p className="price-gap-error">{error}</p>}
    </div>
  );
}
