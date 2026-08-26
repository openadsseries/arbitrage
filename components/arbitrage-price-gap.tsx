"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowRightLeft } from "lucide-react";
import { formatUnits } from "viem";
import { tokenLogoUrl } from "@/components/token-logo";
import {
  type ArbitrageOpportunity,
  type ArbitrageOpportunityRoute,
  type DirectArbitrageExecutionQuote,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import type { VerifiedMarket } from "@/lib/onchain-types";
import type { MarketComparisonState } from "@/lib/server/gecko-comparison";

function displayReserve(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function usd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  if (value > 0 && value < 0.01)
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

function routeCopy(
  route: ArbitrageOpportunityRoute,
  market: VerifiedMarket,
  ownerReturnRaw: string | null,
  reserveDecimals: number,
) {
  const start = `${displayReserve(route.amountInRaw, reserveDecimals)} ${market.reserveSymbol}`;
  const finish = ownerReturnRaw
    ? `${displayReserve(ownerReturnRaw, reserveDecimals)} ${market.reserveSymbol}`
    : market.reserveSymbol;
  if (route.direction === "Mint then sell") {
    return {
      aria: `Start with ${start}, mint ${market.symbol} in Mint Club, sell ${market.symbol} in the pool, and get back ${finish}.`,
    };
  }
  return {
    aria: `Start with ${start}, buy ${market.symbol} in the pool, return ${market.symbol} to Mint Club, and get back ${finish}.`,
  };
}

function formatDailyTick(
  timestamp: number,
  index: number,
  points: Array<{ timestamp: number }>,
) {
  const date = new Date(timestamp * 1000);
  const previous =
    index > 0 ? new Date(points[index - 1].timestamp * 1000) : null;
  const day = String(date.getUTCDate());
  const changedMonth =
    !previous ||
    date.getUTCMonth() !== previous.getUTCMonth() ||
    date.getUTCFullYear() !== previous.getUTCFullYear();
  const isLast = index === points.length - 1;
  if (index === 0) {
    const nextMonthIndex = points.findIndex((point) => {
      const next = new Date(point.timestamp * 1000);
      return next.getUTCMonth() !== date.getUTCMonth() || next.getUTCFullYear() !== date.getUTCFullYear();
    });
    if (nextMonthIndex > 0 && nextMonthIndex / Math.max(points.length - 1, 1) < 0.12) return "";
  }
  if (!changedMonth && !isLast) return "";
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return `${month} ${day}`;
}

function HistoricalPriceChart({
  comparison,
  market,
}: {
  comparison: MarketComparisonState;
  market: VerifiedMarket;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  if (comparison.status !== "ready") {
    const copy = comparison.reason === "not-enough-history"
      ? {
          title: "Price history is building.",
          body: "The chart starts after two daily prices are available.",
        }
      : comparison.reason === "markets-not-ready"
        ? {
            title: "Price history starts when both markets are live.",
            body: "The current market state is still shown above.",
          }
        : {
            title: "Loading price history.",
            body: "Current onchain prices are already available.",
          };
    return (
      <div className="price-history-unavailable" aria-live="polite">
        <strong>{copy.title}</strong>
        <span>{copy.body}</span>
      </div>
    );
  }

  const chain = CHAINS[market.chain];
  const points = comparison.data.points;
  const width = 800;
  const height = 270;
  const left = 18;
  const right = 18;
  const top = 22;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = points.flatMap((point) => [point.og, point.hyped]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(3, (rawMax - rawMin) * 0.12);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index: number) =>
    left + (index / Math.max(points.length - 1, 1)) * plotWidth;
  const y = (value: number) =>
    top + ((max - value) / (max - min || 1)) * plotHeight;
  const line = (key: "og" | "hyped") =>
    points.map((point, index) => `${x(index)},${y(point[key])}`).join(" ");
  const trackedIndex = pinnedIndex ?? hoverIndex;
  const tracked = trackedIndex === null ? null : (points[trackedIndex] ?? null);
  const trackedX = trackedIndex === null ? null : x(trackedIndex);
  const trackedTooltipX =
    trackedX === null
      ? 0
      : Math.min(Math.max(trackedX + 12, left), width - right - 152);
  const trackedTooltipY = tracked
    ? Math.max(
        top + 4,
        Math.min(
          y(Math.max(tracked.og, tracked.hyped)) - 78,
          height - bottom - 92,
        ),
      )
    : 0;
  const trackedDate = tracked
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(tracked.timestamp * 1000))
    : "";
  const updateTrackedPoint = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const ratio = width / rect.width;
    const svgX = (clientX - rect.left) * ratio;
    const nextIndex = Math.round(
      ((svgX - left) / Math.max(plotWidth, 1)) * Math.max(points.length - 1, 1),
    );
    return Math.min(Math.max(nextIndex, 0), points.length - 1);
  };
  const pinTrackedPoint = (clientX: number, svg: SVGSVGElement) => {
    const nextIndex = updateTrackedPoint(clientX, svg);
    setPinnedIndex(pinnedIndex === nextIndex ? null : nextIndex);
  };

  return (
    <figure
      className="price-history-chart"
      aria-label={`Historical price movement for ${market.reserveSymbol} and ${market.symbol}`}
    >
      <div className="price-history-legend">
        <span>
          <i className="og" />
          <Image
            src={tokenLogoUrl(market.reserveToken, chain.id)}
            alt=""
            width={22}
            height={22}
            unoptimized
          />
          <b>{market.reserveSymbol}</b>
        </span>
        <span className="hyped">
          <i />
          <Image
            src={tokenLogoUrl(market.token, chain.id)}
            alt=""
            width={22}
            height={22}
            unoptimized
          />
          <b>{market.symbol}</b>
        </span>
      </div>
      <div className="price-history-plot">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {[top, top + plotHeight / 2, height - bottom].map((lineY) => (
            <line
              className="price-history-grid"
              x1={left}
              x2={width - right}
              y1={lineY}
              y2={lineY}
              key={lineY}
            />
          ))}
          {points.map((point, index) => (
            <g className="price-history-day" key={point.timestamp}>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={height - bottom}
                y2={height - bottom + 4}
              />
              {formatDailyTick(point.timestamp, index, points) && (
                <text x={x(index)} y={height - 13} textAnchor="middle">
                  {formatDailyTick(point.timestamp, index, points)}
                </text>
              )}
            </g>
          ))}
          <polyline className="price-history-line og" points={line("og")} />
          <polyline
            className="price-history-line hyped"
            points={line("hyped")}
          />
          {tracked && trackedX !== null && (
            <g className="price-history-crosshair">
              <line x1={trackedX} x2={trackedX} y1={top} y2={height - bottom} />
              <line
                x1={left}
                x2={width - right}
                y1={y(tracked.og)}
                y2={y(tracked.og)}
              />
              <line
                className="hyped"
                x1={left}
                x2={width - right}
                y1={y(tracked.hyped)}
                y2={y(tracked.hyped)}
              />
              <circle className="og" cx={trackedX} cy={y(tracked.og)} r="4" />
              <circle
                className="hyped"
                cx={trackedX}
                cy={y(tracked.hyped)}
                r="4"
              />
              <foreignObject
                x={trackedTooltipX}
                y={trackedTooltipY}
                width="150"
                height="88"
              >
                <div className="price-history-tooltip">
                  <strong>{trackedDate}</strong>
                  <span>
                    <i className="og" />
                    {market.reserveSymbol} {usd(tracked.ogUsd)}
                  </span>
                  <span>
                    <i className="hyped" />
                    {market.symbol} {usd(tracked.hypedUsd)}
                  </span>
                  <small>
                    {pinnedIndex === null ? "Click to pin" : "Pinned"}
                  </small>
                </div>
              </foreignObject>
            </g>
          )}
          <rect
            className="price-history-hitbox"
            x={left}
            y={top}
            width={plotWidth}
            height={plotHeight}
            onClick={(event) => {
              const svg = event.currentTarget.ownerSVGElement;
              if (svg) pinTrackedPoint(event.clientX, svg);
            }}
            onPointerMove={(event) => {
              const svg = event.currentTarget.ownerSVGElement;
              if (svg) setHoverIndex(updateTrackedPoint(event.clientX, svg));
            }}
          />
        </svg>
      </div>
    </figure>
  );
}

export function ArbitragePriceGap({
  market,
  marketComparison,
  initialOpportunity,
  checkedAmountRaw,
  onEstimatedProfitChange,
  active = false,
  activeQuote = null,
  watchReason = "",
}: {
  market: VerifiedMarket;
  marketComparison: MarketComparisonState;
  initialOpportunity?: ArbitrageOpportunity | null;
  checkedAmountRaw: bigint | null;
  onEstimatedProfitChange?: (raw: string | null) => void;
  active?: boolean;
  activeQuote?: DirectArbitrageExecutionQuote | null;
  watchReason?: string;
}) {
  const initialMatches = Boolean(
    initialOpportunity &&
    initialOpportunity.checkedAmountRaw === checkedAmountRaw?.toString(),
  );
  const [opportunity, setOpportunity] = useState<ArbitrageOpportunity | null>(
    initialMatches ? (initialOpportunity ?? null) : null,
  );
  const [loading, setLoading] = useState(!initialMatches);
  const [error, setError] = useState("");
  const opportunityRef = useRef<ArbitrageOpportunity | null>(
    initialMatches ? (initialOpportunity ?? null) : null,
  );
  const [quotedAmountRaw, setQuotedAmountRaw] = useState<bigint | null>(
    checkedAmountRaw,
  );
  const [comparisonResult, setComparisonResult] = useState({
    token: market.token,
    value: marketComparison,
  });
  const resolvedComparison = comparisonResult.token === market.token
    ? comparisonResult.value
    : marketComparison;

  useEffect(() => {
    if (
      resolvedComparison.status === "ready" ||
      resolvedComparison.reason !== "price-history-unavailable"
    ) return;

    let cancelled = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    const delays = [100, 3_000, 10_000];
    let attempt = 0;

    const refresh = async () => {
      controller = new AbortController();
      try {
        const query = new URLSearchParams({
          chain: market.chain,
          address: market.token,
        });
        const response = await fetch(`/api/market/history?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as {
          comparison?: MarketComparisonState;
        };
        if (cancelled) return;
        if (!response.ok || !payload.comparison) {
          throw new Error("Price history could not be checked.");
        }
        if (payload.comparison.status === "ready") {
          setComparisonResult({ token: market.token, value: payload.comparison });
          return;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
      attempt += 1;
      if (!cancelled && attempt < delays.length) {
        timer = window.setTimeout(refresh, delays[attempt]);
      }
    };

    timer = window.setTimeout(refresh, delays[0]);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [market.chain, market.token, resolvedComparison]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setQuotedAmountRaw(checkedAmountRaw),
      checkedAmountRaw === null ? 0 : 400,
    );
    return () => window.clearTimeout(timer);
  }, [checkedAmountRaw]);

  useEffect(() => {
    if (active) return;
    if (quotedAmountRaw === null) {
      const timer = window.setTimeout(() => {
        opportunityRef.current = null;
        setOpportunity(null);
        setError("");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let alive = true;
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
      fetch(
        `/api/arbitrage/opportunity?token=${market.token}&amountRaw=${quotedAmountRaw}`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      )
        .then(async (response) => {
          const payload = (await response.json()) as {
            opportunity?: ArbitrageOpportunity;
            error?: string;
          };
          if (!response.ok || !payload.opportunity)
            throw new Error(
              payload.error ?? "The price gap could not be checked.",
            );
          if (!alive) return;
          opportunityRef.current = payload.opportunity;
          setOpportunity(payload.opportunity);
          setError("");
        })
        .catch((reason) => {
          if (
            alive &&
            !(reason instanceof DOMException && reason.name === "AbortError")
          ) {
            if (!opportunityRef.current) setOpportunity(null);
            setError(
              reason instanceof Error
                ? reason.message
                : "The price gap could not be checked.",
            );
          }
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    const current = opportunityRef.current;
    const currentIsFresh =
      current?.checkedAmountRaw === quotedAmountRaw.toString() &&
      Math.floor(Date.now() / 1000) - current.quotedAt < 15;
    if (currentIsFresh) {
      setOpportunity(current);
      setLoading(false);
    } else {
      void read(true);
    }
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      alive = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      controller?.abort();
    };
  }, [active, market.token, quotedAmountRaw]);

  const previewRoute = useMemo(() => {
    if (!opportunity) return null;
    return (
      [...opportunity.routes].sort((left, right) => {
        const a = BigInt(left.ownerDifferenceRaw);
        const b = BigInt(right.ownerDifferenceRaw);
        return a === b ? 0 : a > b ? -1 : 1;
      })[0] ?? null
    );
  }, [opportunity]);
  const activeRoute = useMemo<ArbitrageOpportunityRoute | null>(() => {
    if (!activeQuote) return null;
    const ownerProfit = BigInt(activeQuote.expectedOwnerProfitRaw);
    const amountIn = BigInt(activeQuote.amountInReserveRaw);
    const netReturnBps =
      amountIn > 0n ? Number((ownerProfit * 10_000n) / amountIn) : 0;
    return {
      direction:
        activeQuote.direction === 0 ? "Mint then sell" : "Buy then redeem",
      amountInRaw: activeQuote.amountInReserveRaw,
      amountOutRaw: activeQuote.expectedReturnRaw,
      hAmountRaw:
        activeQuote.direction === 0
          ? activeQuote.params.hAmountForMint
          : activeQuote.params.minimumHypedOut,
      grossDifferenceRaw: (
        BigInt(activeQuote.expectedOwnerProfitRaw) +
        BigInt(activeQuote.expectedExecutorRewardRaw)
      ).toString(),
      ownerDifferenceRaw: activeQuote.expectedOwnerProfitRaw,
      netReturnBps,
      withinLimit: true,
      netPositive: ownerProfit > 0n,
      gapBps: netReturnBps,
      profitable: ownerProfit > 0n,
    };
  }, [activeQuote]);
  const route = activeRoute ?? previewRoute;
  const netPositive = Boolean(route && (route.netPositive ?? route.profitable));
  const chain = CHAINS[market.chain];
  const ownerReturnRaw = route
    ? (BigInt(route.amountInRaw) + BigInt(route.ownerDifferenceRaw)).toString()
    : null;
  const routeDetails = route
    ? routeCopy(
        route,
        market,
        ownerReturnRaw,
        opportunity?.reserveDecimals ?? market.reserveDecimals,
      )
    : null;
  const headline = (() => {
    if (netPositive && route)
      return `+${((route.netReturnBps ?? route.gapBps) / 100).toFixed(2)}% profit opportunity`;
    if (watchReason === "Base is busy. Try again soon.")
      return "Checking prices";
    if (
      active &&
      (watchReason === "No route now." || watchReason === "Not executable now.")
    )
      return "No profit right now";
    if (active && !activeQuote) return "Checking prices";
    if (!active && loading) return "Checking prices";
    if (quotedAmountRaw === null) return "Enter an amount";
    return "No profit right now";
  })();

  useEffect(() => {
    onEstimatedProfitChange?.(
      netPositive && route ? route.ownerDifferenceRaw : null,
    );
  }, [netPositive, onEstimatedProfitChange, route]);

  return (
    <div className="price-gap-view">
      <div className="price-gap-heading">
        <span className="kicker">1. Check profit</span>
        <h2>
          <strong>{headline}</strong>
        </h2>
      </div>

      <HistoricalPriceChart comparison={resolvedComparison} market={market} />

      {route && (
        <>
          <div className="price-gap-route-wrap">
            <span>Arbitrage path</span>
            <div
              className="price-gap-route visual"
              aria-label={routeDetails?.aria ?? "Profit path"}
            >
              <span className="route-chip endpoint">
                <Image
                  src={tokenLogoUrl(market.reserveToken, chain.id)}
                  alt=""
                  width={26}
                  height={26}
                  unoptimized
                />
                <b>
                  {displayReserve(
                    route.amountInRaw,
                    opportunity?.reserveDecimals ?? market.reserveDecimals,
                  )}{" "}
                  {market.reserveSymbol}
                </b>
              </span>
              <ArrowRight />
              {route.direction === "Buy then redeem" && (
                <span className="route-chip route-swap">
                  <Image
                    src={tokenLogoUrl(market.reserveToken, chain.id)}
                    alt=""
                    width={26}
                    height={26}
                    unoptimized
                  />
                  <ArrowRightLeft />
                  <Image
                    src={tokenLogoUrl(market.token, chain.id)}
                    alt=""
                    width={26}
                    height={26}
                    unoptimized
                  />
                </span>
              )}
              {route.direction === "Mint then sell" && (
                <span className="route-chip hyped">
                  <Image
                    src={tokenLogoUrl(market.token, chain.id)}
                    alt=""
                    width={26}
                    height={26}
                    unoptimized
                  />
                  <b>{market.symbol}</b>
                </span>
              )}
              <ArrowRight />
              {route.direction === "Mint then sell" && (
                <span className="route-chip route-swap">
                  <Image
                    src={tokenLogoUrl(market.token, chain.id)}
                    alt=""
                    width={26}
                    height={26}
                    unoptimized
                  />
                  <ArrowRightLeft />
                  <Image
                    src={tokenLogoUrl(market.reserveToken, chain.id)}
                    alt=""
                    width={26}
                    height={26}
                    unoptimized
                  />
                </span>
              )}
              {route.direction === "Buy then redeem" && (
                <span className="route-chip hyped">
                  <Image
                    src={tokenLogoUrl(market.token, chain.id)}
                    alt=""
                    width={26}
                    height={26}
                    unoptimized
                  />
                  <b>{market.symbol}</b>
                </span>
              )}
              <ArrowRight />
              <span className="route-chip endpoint return">
                {ownerReturnRaw && (
                  <>
                    <Image
                      src={tokenLogoUrl(market.reserveToken, chain.id)}
                      alt=""
                      width={26}
                      height={26}
                      unoptimized
                    />
                    <b>
                      {displayReserve(
                        ownerReturnRaw,
                        opportunity?.reserveDecimals ?? market.reserveDecimals,
                      )}
                    </b>
                  </>
                )}
              </span>
            </div>
          </div>
        </>
      )}

      {error && <p className="price-gap-error">{error}</p>}
    </div>
  );
}
