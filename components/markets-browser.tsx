"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Search } from "lucide-react";
import { formatUnits, isAddress } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { tokenLogoUrl } from "@/components/token-logo";
import { CHAINS, type ChainKey } from "@/lib/chains";
import { compact, usd } from "@/lib/format";
import { readManifests } from "@/lib/manifest";
import type { VerifiedMarket } from "@/lib/onchain-types";

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

export function MarketsBrowser({ initial, unavailableChains }: { initial: VerifiedMarket[]; unavailableChains: ChainKey[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [addressMatches, setAddressMatches] = useState<VerifiedMarket[]>([]);
  const [walletLaunched, setWalletLaunched] = useState<VerifiedMarket[]>([]);

  useEffect(() => {
    const addresses = readManifests()
      .filter((manifest) => manifest.stage === "verified" && manifest.execution.hypedToken)
      .map((manifest) => manifest.execution.hypedToken!);
    if (addresses.length === 0) return;
    void Promise.all(addresses.map(async (address) => {
      const response = await fetch(`/api/market?address=${address}`, { cache: "no-store" });
      const payload = await response.json() as { markets?: VerifiedMarket[] };
      return response.ok ? payload.markets ?? [] : [];
    })).then((results) => setWalletLaunched(results.flat()));
  }, []);

  const allMarkets = useMemo(() => {
    const map = new Map<string, VerifiedMarket>();
    for (const market of [...initial, ...walletLaunched]) map.set(`${market.chain}-${market.token.toLowerCase()}`, market);
    return [...map.values()];
  }, [initial, walletLaunched]);
  const markets = useMemo(() => allMarkets.filter((market) => {
    const search = `${market.name} ${market.symbol} ${market.reserveName} ${market.reserveSymbol} ${market.token}`.toLowerCase();
    return search.includes(query.trim().toLowerCase());
  }), [allMarkets, query]);

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
      {addressMatches.length > 1 && <div className="network-match-list" aria-label="Matching markets">{addressMatches.map((market) => <button key={`${market.chain}-${market.token}`} type="button" onClick={() => router.push(`/market/${market.chain}/${market.token}`)}><ChainBadge chain={market.chain} /><span><strong>{market.symbol}</strong><small>{CHAINS[market.chain].name}</small></span><ArrowRight /></button>)}</div>}
      {unavailableChains.length > 0 && <p className="partial-note">Some networks are temporarily unavailable. Available markets remain live.</p>}
      {markets.length === 0 ? (
        <div className="empty-state compact">
          <h2>{query ? "No matching market." : "No Hyped Token pool yet."}</h2>
          <p>{query ? "Enter a Hyped Token address to search every supported network." : "Open any supported Hyped Token directly by its address."}</p>
        </div>
      ) : (
        <div className="market-table onchain-market-table">
          <div className="table-head"><span>Market</span><span>Price</span><span>Market cap</span><span>Backing</span><span>Action</span></div>
          {markets.map((market) => (
            <div className="market-row" key={`${market.chain}-${market.token}`}>
              <Link className="market-name with-logo" href={`/market/${market.chain}/${market.token}`}>
                <span className="token-chain-logo"><Image src={tokenLogoUrl(market.token, market.chain === "base" ? 8453 : 4663)} alt="" width={34} height={34} unoptimized /><ChainBadge chain={market.chain} /></span>
                <b>{market.symbol}<small>{market.reserveSymbol} reserve</small></b>
              </Link>
              <span className="market-number" data-label="Price">
                <strong>{market.priceUsd === null ? `${amount(market.nextMintPriceRaw, market.reserveDecimals)} ${market.reserveSymbol}` : priceUsd(market.priceUsd)}</strong>
                {market.priceUsd !== null && <small>{amount(market.nextMintPriceRaw, market.reserveDecimals)} {market.reserveSymbol}</small>}
              </span>
              <strong className="market-number" data-label="Market cap" title="Current supply multiplied by the current buy price">{market.impliedMarketCapUsd === null ? `${amount(market.impliedMarketCapReserveRaw, market.reserveDecimals)} ${market.reserveSymbol}` : marketCapUsd(market.impliedMarketCapUsd)}</strong>
              <strong className="market-number" data-label="Backing">{amount(market.reserveBalanceRaw, market.reserveDecimals)} {market.reserveSymbol}</strong>
              <Link className="market-buy" href={`/market/${market.chain}/${market.token}`}>Arbitrage</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
