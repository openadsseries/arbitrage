"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ExternalLink, LoaderCircle, WalletCards } from "lucide-react";
import { formatUnits } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { ArbitragePortfolio } from "@/components/arbitrage-portfolio";
import { tokenLogoUrl } from "@/components/token-logo";
import { useWallet } from "@/components/wallet-provider";
import { CHAINS, type ChainKey } from "@/lib/chains";
import { compact, shortAddress } from "@/lib/format";
import type { PortfolioSnapshot } from "@/lib/onchain-types";

type Tab = "positions" | "launches" | "arbitrage" | "activity";

function amount(raw: string, decimals: number) {
  return compact(Number(formatUnits(BigInt(raw), decimals)));
}

export function PortfolioView() {
  const { address, connect } = useWallet();
  const [tab, setTab] = useState<Tab>("positions");
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [arbitrageMarkets, setArbitrageMarkets] = useState<PortfolioSnapshot["launches"]>([]);
  const [arbitrageBusy, setArbitrageBusy] = useState(true);
  const [unavailableChains, setUnavailableChains] = useState<ChainKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!address) {
      // Wallet disconnection invalidates the external account snapshot immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshots([]);
      setUnavailableChains([]);
      setError("");
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError("");
    fetch(`/api/portfolio?wallet=${address}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { portfolios?: PortfolioSnapshot[]; unavailableChains?: ChainKey[]; error?: string };
        if (!response.ok || !payload.portfolios) throw new Error(payload.error ?? "Could not read portfolio.");
        setSnapshots(payload.portfolios);
        setUnavailableChains(payload.unavailableChains ?? []);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Could not read portfolio.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [address]);

  useEffect(() => {
    if (!address || tab !== "arbitrage") return;
    const controller = new AbortController();
    fetch("/api/markets", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { markets?: PortfolioSnapshot["launches"]; error?: string };
        if (!response.ok || !payload.markets) throw new Error(payload.error ?? "Could not read arbitrage markets.");
        setArbitrageMarkets(payload.markets);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Could not read arbitrage markets.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setArbitrageBusy(false);
      });
    return () => controller.abort();
  }, [address, tab]);

  const positions = useMemo(() => snapshots.flatMap((snapshot) => snapshot.positions), [snapshots]);
  const launches = useMemo(() => snapshots.flatMap((snapshot) => snapshot.launches), [snapshots]);
  const activity = useMemo(() => snapshots.flatMap((snapshot) => snapshot.activity), [snapshots]);
  const arbitrageMarketCatalog = useMemo(() => {
    const marketMap = new Map<string, PortfolioSnapshot["launches"][number]>();
    for (const market of [...arbitrageMarkets, ...launches]) marketMap.set(`${market.chain}:${market.token.toLowerCase()}`, market);
    return [...marketMap.values()];
  }, [arbitrageMarkets, launches]);

  return (
    <div className="inner-page page-shell portfolio-page">
      <div className="page-title">
        <h1>Portfolio</h1>
        <p>Assets, pools, arbitrage, and activity from this wallet.</p>
      </div>
      <div className="page-tabs portfolio-tabs" role="tablist" aria-label="Portfolio controls">
        <button aria-selected={tab === "positions"} className={tab === "positions" ? "selected" : ""} onClick={() => setTab("positions")} role="tab" type="button">Assets</button>
        <button aria-selected={tab === "arbitrage"} className={tab === "arbitrage" ? "selected" : ""} onClick={() => { if (arbitrageMarkets.length === 0) setArbitrageBusy(true); setTab("arbitrage"); }} role="tab" type="button">Arbitrage</button>
        <button aria-selected={tab === "launches"} className={tab === "launches" ? "selected" : ""} onClick={() => setTab("launches")} role="tab" type="button">Pools</button>
        <button aria-selected={tab === "activity"} className={tab === "activity" ? "selected" : ""} onClick={() => setTab("activity")} role="tab" type="button">Activity</button>
      </div>

      {!address ? (
        <div className="empty-state compact portfolio-empty"><WalletCards /><h2>Connect a wallet to read positions.</h2><p>No account data is inferred or stored by the page.</p><button className="button-primary" onClick={() => void connect()} type="button">Connect wallet</button></div>
      ) : tab === "arbitrage" ? (
        arbitrageBusy && arbitrageMarkets.length === 0
          ? <div className="empty-state compact"><LoaderCircle className="spin" /><h2>Reading arbitrage markets</h2><p>Executable Base routes are being verified.</p></div>
          : <ArbitragePortfolio wallet={address} markets={arbitrageMarketCatalog} />
      ) : busy ? (
        <div className="empty-state compact"><LoaderCircle className="spin" /><h2>Reading onchain positions</h2><p>Balances and current return values are being read across supported networks.</p></div>
      ) : error ? (
        <div className="alert danger"><WalletCards /><div><strong>Portfolio read failed</strong><p>{error}</p></div></div>
      ) : snapshots.length ? (
        <>
          {unavailableChains.length > 0 && <p className="partial-note">Some networks are temporarily unavailable. Available positions remain visible.</p>}
          {tab === "positions" && (
            positions.length ? <div className="position-grid">{positions.map((position) => (
              <article className="position-card" key={`${position.market.chain}-${position.market.token}`}>
                <div className="position-head">
                  <span><span className="token-chain-logo"><Image src={tokenLogoUrl(position.market.token, position.market.chain === "base" ? 8453 : 4663)} alt="" width={42} height={42} unoptimized /><ChainBadge chain={position.market.chain} /></span><b>{position.market.symbol}<small>{position.market.name}</small></b></span>
                  <Link href={`/market/${position.market.chain}/${position.market.token}`} aria-label={`Open ${position.market.symbol}`}><ArrowRight /></Link>
                </div>
                <dl>
                  <div><dt>Balance</dt><dd>{amount(position.balanceRaw, position.market.decimals)} {position.market.symbol}</dd></div>
                  <div><dt>Current return</dt><dd>{amount(position.redeemableRaw, position.market.reserveDecimals)} {position.market.reserveSymbol}</dd></div>
                  <div><dt>Return fee</dt><dd>{amount(position.burnRoyaltyRaw, position.market.reserveDecimals)} {position.market.reserveSymbol}</dd></div>
                  <div><dt>Cost basis</dt><dd>Unavailable</dd></div>
                </dl>
                <p>Exit value is what the full balance can return now. It is not a last-price valuation.</p>
              </article>
            ))}</div> : <EmptyPortfolio title="No Hyped Token position." body="Only verified GETHYPED Hyped Token balances appear here." />
          )}
          {tab === "launches" && (
            launches.length ? <section className="portfolio-section">
              <div className="section-heading portfolio-heading"><h2>Pools</h2><span>{launches.length} confirmed</span></div>
              <div className="portfolio-table pool-table">
                <div className="portfolio-table-head" aria-hidden="true"><span>Pool</span><span>Reserve</span><span>Network</span><span>Block</span><span>Action</span></div>
                {launches.map((market) => (
                  <Link className="portfolio-row" href={`/market/${market.chain}/${market.token}`} key={`${market.chain}-${market.token}`}>
                    <div className="portfolio-market"><span className="token-chain-logo"><Image src={tokenLogoUrl(market.token, CHAINS[market.chain].id)} alt="" width={34} height={34} unoptimized /><ChainBadge chain={market.chain} /></span><span><strong>{market.symbol}</strong><small>{market.name}</small></span></div>
                    <strong>{market.reserveSymbol}</strong>
                    <span>{CHAINS[market.chain].shortName}</span>
                    <b>{market.blockNumber}</b>
                    <ArrowRight />
                  </Link>
                ))}
              </div>
            </section> : <EmptyPortfolio title="No pools." body="Confirmed pools created by this wallet appear here." />
          )}
          {tab === "activity" && (
            activity.length ? <section className="portfolio-section">
              <div className="section-heading portfolio-heading"><h2>Activity</h2><span>{activity.length} confirmed</span></div>
              <div className="portfolio-table activity-table">
                <div className="portfolio-table-head" aria-hidden="true"><span>Type</span><span>Token</span><span>Reserve</span><span>Block</span><span>Action</span></div>
                {activity.map((item) => (
                  <a className="portfolio-row" href={`${CHAINS[item.chain].explorerUrl}/tx/${item.transactionHash}`} key={`${item.chain}-${item.transactionHash}-${item.type}`} target="_blank" rel="noreferrer">
                    <div className="portfolio-market"><span className={`activity-type ${item.type.toLowerCase()}`}>{item.type}</span><span><strong>{item.tokenSymbol}</strong><small>{CHAINS[item.chain].shortName}</small></span></div>
                    <strong>{amount(item.tokenAmountRaw, item.tokenDecimals)} {item.tokenSymbol}</strong>
                    <span>{amount(item.reserveAmountRaw, item.reserveDecimals)} {item.reserveSymbol}</span>
                    <b>{item.blockNumber}</b>
                    <ExternalLink />
                  </a>
                ))}
              </div>
            </section> : <EmptyPortfolio title="No activity." body="Confirmed buys and returns appear here." />
          )}
          <p className="source-note">Wallet {shortAddress(address)} · Live reads across supported networks</p>
        </>
      ) : <EmptyPortfolio title="No supported network data." body="No inferred positions are shown when a live read is unavailable." />}
    </div>
  );
}

function EmptyPortfolio({ title, body }: { title: string; body: string }) {
  return <div className="empty-state compact"><WalletCards /><h2>{title}</h2><p>{body}</p></div>;
}
