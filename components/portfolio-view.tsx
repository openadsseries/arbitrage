"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ExternalLink, WalletCards } from "lucide-react";
import { formatUnits } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { ArbitragePortfolio } from "@/components/arbitrage-portfolio";
import { tokenLogoUrl } from "@/components/token-logo";
import { useWallet } from "@/components/wallet-provider";
import { CHAINS } from "@/lib/chains";
import { compact } from "@/lib/format";
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

  useEffect(() => {
    if (!address) {
      // Wallet disconnection invalidates the external account snapshot immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshots([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/portfolio?wallet=${address}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { portfolios?: PortfolioSnapshot[]; error?: string };
        if (!response.ok || !payload.portfolios) throw new Error(payload.error ?? "Could not read portfolio.");
        setSnapshots(payload.portfolios);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setSnapshots([]);
        }
      })
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
          setArbitrageMarkets([]);
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
      </div>
      <div className="page-tabs portfolio-tabs" role="tablist" aria-label="Portfolio controls">
        <button aria-selected={tab === "positions"} className={tab === "positions" ? "selected" : ""} onClick={() => setTab("positions")} role="tab" type="button">Assets</button>
        <button aria-selected={tab === "arbitrage"} className={tab === "arbitrage" ? "selected" : ""} onClick={() => { if (arbitrageMarkets.length === 0) setArbitrageBusy(true); setTab("arbitrage"); }} role="tab" type="button">Arbitrage</button>
        <button aria-selected={tab === "launches"} className={tab === "launches" ? "selected" : ""} onClick={() => setTab("launches")} role="tab" type="button">Pools</button>
        <button aria-selected={tab === "activity"} className={tab === "activity" ? "selected" : ""} onClick={() => setTab("activity")} role="tab" type="button">Activity</button>
      </div>

      {!address ? (
        <div className="empty-state compact portfolio-empty"><WalletCards /><h2>Connect wallet</h2><button className="button-primary" onClick={() => void connect()} type="button">Connect wallet</button></div>
      ) : tab === "arbitrage" ? (
        <ArbitragePortfolio wallet={address} markets={arbitrageBusy && arbitrageMarkets.length === 0 ? launches : arbitrageMarketCatalog} />
      ) : (
        <>
          {tab === "positions" && (
            <section className="portfolio-section">
              <div className="portfolio-table assets-table">
                <div className="portfolio-table-head" aria-hidden="true"><span>Asset</span><span>Balance</span><span>Return</span><span>Fee</span><span>Action</span></div>
                {positions.length ? positions.map((position) => (
                  <Link className="portfolio-row" href={`/market/${position.market.chain}/${position.market.token}`} key={`${position.market.chain}-${position.market.token}`} aria-label={`Open ${position.market.symbol}`}>
                    <div className="portfolio-market"><span className="token-chain-logo"><Image src={tokenLogoUrl(position.market.token, position.market.chain === "base" ? 8453 : 4663)} alt="" width={34} height={34} unoptimized /><ChainBadge chain={position.market.chain} /></span><span><strong>{position.market.symbol}</strong><small>{position.market.name}</small></span></div>
                    <strong>{amount(position.balanceRaw, position.market.decimals)} {position.market.symbol}</strong>
                    <span>{amount(position.redeemableRaw, position.market.reserveDecimals)} {position.market.reserveSymbol}</span>
                    <b>{amount(position.burnRoyaltyRaw, position.market.reserveDecimals)} {position.market.reserveSymbol}</b>
                    <ArrowRight />
                  </Link>
                )) : <EmptyPortfolioRow first="None" values={["0", "0", "0"]} />}
              </div>
            </section>
          )}
          {tab === "launches" && (
            <section className="portfolio-section">
              <div className="portfolio-table pool-table">
                <div className="portfolio-table-head" aria-hidden="true"><span>Pool</span><span>Reserve</span><span>Network</span><span>Block</span><span>Action</span></div>
                {launches.length ? launches.map((market) => (
                  <Link className="portfolio-row" href={`/market/${market.chain}/${market.token}`} key={`${market.chain}-${market.token}`}>
                    <div className="portfolio-market"><span className="token-chain-logo"><Image src={tokenLogoUrl(market.token, CHAINS[market.chain].id)} alt="" width={34} height={34} unoptimized /><ChainBadge chain={market.chain} /></span><span><strong>{market.symbol}</strong><small>{market.name}</small></span></div>
                    <strong>{market.reserveSymbol}</strong>
                    <span>{CHAINS[market.chain].shortName}</span>
                    <b>{market.blockNumber}</b>
                    <ArrowRight />
                  </Link>
                )) : <EmptyPortfolioRow first="None" values={["None", "None", "0"]} />}
              </div>
            </section>
          )}
          {tab === "activity" && (
            <section className="portfolio-section">
              <div className="portfolio-table activity-table">
                <div className="portfolio-table-head" aria-hidden="true"><span>Type</span><span>Token</span><span>Reserve</span><span>Block</span><span>Action</span></div>
                {activity.length ? activity.map((item) => {
                  const action = item.type === "Mint" ? "Buy" : "Sell";
                  return <a className="portfolio-row" href={`${CHAINS[item.chain].explorerUrl}/tx/${item.transactionHash}`} key={`${item.chain}-${item.transactionHash}-${item.type}`} target="_blank" rel="noreferrer">
                    <div className="portfolio-market"><span className={`activity-type ${item.type.toLowerCase()}`}>{action}</span><span><strong>{item.tokenSymbol}</strong><small>{CHAINS[item.chain].shortName}</small></span></div>
                    <strong>{amount(item.tokenAmountRaw, item.tokenDecimals)} {item.tokenSymbol}</strong>
                    <span>{amount(item.reserveAmountRaw, item.reserveDecimals)} {item.reserveSymbol}</span>
                    <b>{item.blockNumber}</b>
                    <ExternalLink />
                  </a>;
                }) : <EmptyPortfolioRow first="None" values={["0", "0", "0"]} />}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function EmptyPortfolioRow({ first, values }: { first: string; values: [string, string, string] }) {
  return <div className="portfolio-row empty-row"><div className="portfolio-market"><span><strong>{first}</strong></span></div><strong>{values[0]}</strong><span>{values[1]}</span><b>{values[2]}</b><span>—</span></div>;
}
