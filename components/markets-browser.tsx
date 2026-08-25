"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Search } from "lucide-react";
import { formatUnits, isAddress } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { tokenLogoUrl } from "@/components/token-logo";
import type { ArbitrageOpportunity, ArbitrageOpportunityRoute } from "@/lib/arbitrage";
import { CHAINS, type ChainKey } from "@/lib/chains";
import { compact, usd } from "@/lib/format";
import { readManifests } from "@/lib/manifest";
import type { VerifiedMarket } from "@/lib/onchain-types";

type ArbitragePreviewState =
  | { status: "checking" }
  | { status: "ready"; bps: number; route: ArbitrageOpportunityRoute["direction"] | null; positive: boolean }
  | { status: "unavailable" };

function amount(raw: string, decimals: number) {
  return compact(Number(formatUnits(BigInt(raw), decimals)));
}

function priceUsd(value: number) {
  if (value >= 1) return usd(value, 2);
  if (value >= 0.01) return usd(value, 4);
  return `$${value.toPrecision(3)}`;
}

function marketCapUsd(value: number) {
  return value >= 1_000 ? `$${compact(value)}` : usd(value, 2);
}

function bestRoute(opportunity: ArbitrageOpportunity) {
  return [...opportunity.routes].sort((left, right) => {
    const a = BigInt(left.ownerDifferenceRaw);
    const b = BigInt(right.ownerDifferenceRaw);
    return a === b ? 0 : a > b ? -1 : 1;
  })[0] ?? null;
}

function oneReserveToken(decimals: number) {
  return (10n ** BigInt(decimals)).toString();
}

function previewLabel(preview: ArbitragePreviewState | undefined) {
  if (!preview || preview.status === "checking") return "Checking";
  if (preview.status === "unavailable") return "—";
  if (!preview.positive) return "0.00%";
  return `+${(preview.bps / 100).toFixed(2)}%`;
}

function previewHint(preview: ArbitragePreviewState | undefined) {
  if (!preview || preview.status === "checking") return "Live quote";
  if (preview.status === "unavailable") return "Not ready";
  if (!preview.positive) return "No gap";
  return preview.route === "Mint then sell" ? "Mint, sell pool" : "Buy, redeem";
}

export function MarketsBrowser({
  initial,
  unavailableChains,
  initialError = "",
}: {
  initial: VerifiedMarket[];
  unavailableChains: ChainKey[];
  initialError?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [marketError, setMarketError] = useState(initialError);
  const [loadingMarkets, setLoadingMarkets] = useState(initial.length === 0 && Boolean(initialError));
  const [remoteMarkets, setRemoteMarkets] = useState(initial);
  const [remoteUnavailableChains, setRemoteUnavailableChains] = useState(unavailableChains);
  const [addressMatches, setAddressMatches] = useState<VerifiedMarket[]>([]);
  const [walletLaunched, setWalletLaunched] = useState<VerifiedMarket[]>([]);
  const [arbitragePreviews, setArbitragePreviews] = useState<Record<string, ArbitragePreviewState>>({});
  const launchedRequests = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/markets", { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { markets?: VerifiedMarket[]; unavailableChains?: ChainKey[]; error?: string };
        if (!response.ok || !payload.markets) throw new Error(payload.error ?? "Could not read markets.");
        if (!active) return;
        setRemoteMarkets(payload.markets);
        setRemoteUnavailableChains(payload.unavailableChains ?? []);
        setMarketError("");
      } catch (reason) {
        if (active && !(reason instanceof DOMException && reason.name === "AbortError")) {
          setMarketError(reason instanceof Error ? reason.message : "Could not read markets.");
        }
      } finally {
        if (active) setLoadingMarkets(false);
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    if (initialError) void read();
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [initialError]);

  useEffect(() => {
    const existing = new Set(remoteMarkets.map((market) => market.token.toLowerCase()));
    const addresses = readManifests()
      .filter((manifest) => manifest.stage === "verified" && manifest.execution.hypedToken)
      .map((manifest) => manifest.execution.hypedToken!)
      .filter((address) => !existing.has(address.toLowerCase()) && !launchedRequests.current.has(address.toLowerCase()));
    if (addresses.length === 0) return;
    addresses.forEach((address) => launchedRequests.current.add(address.toLowerCase()));
    const timeout = window.setTimeout(() => {
      void Promise.all(addresses.map(async (address) => {
        const response = await fetch(`/api/market?address=${address}`, { cache: "no-store" });
        const payload = await response.json() as { markets?: VerifiedMarket[] };
        return response.ok ? payload.markets ?? [] : [];
      })).then((results) => setWalletLaunched((current) => [...current, ...results.flat()]));
    }, 1_500);
    return () => window.clearTimeout(timeout);
  }, [remoteMarkets]);

  const allMarkets = useMemo(() => {
    const map = new Map<string, VerifiedMarket>();
    for (const market of [...remoteMarkets, ...walletLaunched]) map.set(`${market.chain}-${market.token.toLowerCase()}`, market);
    return [...map.values()];
  }, [remoteMarkets, walletLaunched]);
  const markets = useMemo(() => allMarkets.filter((market) => {
    const search = `${market.name} ${market.symbol} ${market.reserveName} ${market.reserveSymbol} ${market.token}`.toLowerCase();
    return search.includes(query.trim().toLowerCase());
  }), [allMarkets, query]);
  const marketKeys = useMemo(() => markets.map((market) => `${market.chain}-${market.token.toLowerCase()}`).join("|"), [markets]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const quoteOne = async (market: VerifiedMarket) => {
      const key = `${market.chain}-${market.token.toLowerCase()}`;
      if (market.chain !== "base") {
        if (active) setArbitragePreviews((current) => ({ ...current, [key]: { status: "unavailable" } }));
        return;
      }
      if (active) setArbitragePreviews((current) => current[key] ? current : { ...current, [key]: { status: "checking" } });
      try {
        const response = await fetch(`/api/arbitrage/opportunity?token=${market.token}&amountRaw=${oneReserveToken(market.reserveDecimals)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { opportunity?: ArbitrageOpportunity; error?: string };
        if (!response.ok || !payload.opportunity) throw new Error(payload.error ?? "Quote unavailable.");
        const route = bestRoute(payload.opportunity);
        if (!active) return;
        setArbitragePreviews((current) => ({
          ...current,
          [key]: route
            ? {
              status: "ready",
              bps: route.netReturnBps ?? route.gapBps,
              route: route.direction,
              positive: Boolean(route.netPositive ?? route.profitable),
            }
            : { status: "unavailable" },
        }));
      } catch {
        if (!active || controller.signal.aborted) return;
        setArbitragePreviews((current) => ({ ...current, [key]: { status: "unavailable" } }));
      }
    };
    const quote = async () => {
      const concurrency = 4;
      let index = 0;
      const workers = Array.from({ length: Math.min(concurrency, markets.length) }, async () => {
        while (active && index < markets.length) {
          const market = markets[index];
          index += 1;
          await quoteOne(market);
        }
      });
      await Promise.all(workers);
    };
    void quote();
    return () => {
      active = false;
      controller.abort();
    };
  }, [marketKeys, markets]);

  async function openBond() {
    const address = query.trim();
    if (!isAddress(address)) return;
    setOpening(true);
    setError("");
    setAddressMatches([]);
    try {
      const response = await fetch(`/api/market?address=${address}`);
      const payload = await response.json() as { markets?: VerifiedMarket[]; error?: string };
      if (!response.ok || !payload.markets?.length) throw new Error(payload.error ?? "Market not found.");
      if (payload.markets.length === 1) {
        const market = payload.markets[0];
        router.push(`/market/${market.chain}/${market.token}`);
      } else {
        setAddressMatches(payload.markets);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Market not found.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="inner-page page-shell">
      <div className="page-title">
        <span className="kicker">Onchain Hyped Token pools</span>
        <h1>Markets</h1>
        <p>Live Hyped Token pools across every supported network.</p>
      </div>
      <form className="market-toolbar" onSubmit={(event) => { event.preventDefault(); void openBond(); }}>
        <div><Search /><input aria-label="Search markets" placeholder="Search token, reserve or address" value={query} onChange={(event) => { setQuery(event.target.value); setAddressMatches([]); }} /></div>
        {isAddress(query.trim()) && <button className="button-ghost" disabled={opening} type="submit">{opening ? <LoaderCircle className="spin" /> : <>Open market <ArrowRight /></>}</button>}
        <Link className="button-primary" href="/launch">Create a pool <ArrowRight /></Link>
      </form>
      {error && <p className="form-error">{error}</p>}
      {marketError && <p className="form-error">{marketError}</p>}
      {addressMatches.length > 1 && <div className="network-match-list" aria-label="Matching markets">{addressMatches.map((market) => <button key={`${market.chain}-${market.token}`} type="button" onClick={() => router.push(`/market/${market.chain}/${market.token}`)}><ChainBadge chain={market.chain} /><span><strong>{market.symbol}</strong><small>{CHAINS[market.chain].name}</small></span><ArrowRight /></button>)}</div>}
      {remoteUnavailableChains.length > 0 && <p className="partial-note">Some networks are temporarily unavailable. Available markets remain live.</p>}
      {loadingMarkets && markets.length === 0 ? (
        <div className="market-table onchain-market-table loading">
          <div className="table-head"><span>Market</span><span>Price</span><span>Market cap</span><span>Backing</span><span>Arbitrage</span><span>Action</span></div>
          {[0, 1, 2, 3].map((item) => <div className="market-row skeleton-row" key={item}><span /><span /><span /><span /><span /><span /></div>)}
        </div>
      ) : markets.length === 0 ? (
        <div className="empty-state compact">
          <h2>{query ? "No matching market." : "No Hyped Token pool yet."}</h2>
          <p>{query ? "Enter a Hyped Token address to search every supported network." : "Open any supported Hyped Token directly by its address."}</p>
        </div>
      ) : (
        <div className="market-table onchain-market-table">
          <div className="table-head"><span>Market</span><span>Price</span><span>Market cap</span><span>Backing</span><span>Arbitrage</span><span>Action</span></div>
          {markets.map((market) => {
            const preview = arbitragePreviews[`${market.chain}-${market.token.toLowerCase()}`];
            const href = `/market/${market.chain}/${market.token}`;
            const prefetch = () => router.prefetch(href);
            return (
            <div className="market-row" key={`${market.chain}-${market.token}`}>
              <Link className="market-name with-logo" href={href} onFocus={prefetch} onMouseEnter={prefetch}>
                <span className="token-chain-logo"><Image src={tokenLogoUrl(market.token, market.chain === "base" ? 8453 : 4663)} alt="" width={34} height={34} unoptimized /><ChainBadge chain={market.chain} /></span>
                <b>{market.symbol}<small>{market.reserveSymbol} reserve</small></b>
              </Link>
              <span className="market-number" data-label="Price">
                <strong>{market.priceUsd === null ? `${amount(market.nextMintPriceRaw, market.reserveDecimals)} ${market.reserveSymbol}` : priceUsd(market.priceUsd)}</strong>
                {market.priceUsd !== null && <small>{amount(market.nextMintPriceRaw, market.reserveDecimals)} {market.reserveSymbol}</small>}
              </span>
              <strong className="market-number" data-label="Market cap" title="Current supply multiplied by the current buy price">{market.impliedMarketCapUsd === null ? `${amount(market.impliedMarketCapReserveRaw, market.reserveDecimals)} ${market.reserveSymbol}` : marketCapUsd(market.impliedMarketCapUsd)}</strong>
              <strong className="market-number" data-label="Backing">{amount(market.reserveBalanceRaw, market.reserveDecimals)} {market.reserveSymbol}</strong>
              <span className={`market-number market-arbitrage-preview ${preview?.status === "ready" && preview.positive ? "positive" : ""}`} data-label="Arbitrage">
                <strong>{previewLabel(preview)}</strong>
                <small>{previewHint(preview)}</small>
              </span>
              <Link className="market-buy" href={href} onFocus={prefetch} onMouseEnter={prefetch}>Arbitrage</Link>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}
