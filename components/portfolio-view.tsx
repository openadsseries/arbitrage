"use client";

import { useEffect, useState } from "react";
import { WalletCards } from "lucide-react";
import { ArbitragePortfolio } from "@/components/arbitrage-portfolio";
import { useWallet } from "@/components/wallet-provider";
import type { VerifiedMarket } from "@/lib/onchain-types";

export function PortfolioView() {
  const { address, connect } = useWallet();
  const [markets, setMarkets] = useState<VerifiedMarket[]>([]);

  useEffect(() => {
    if (!address) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMarkets([]);
      return;
    }
    const controller = new AbortController();
    fetch("/api/markets", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { markets?: VerifiedMarket[]; error?: string };
        if (!response.ok || !payload.markets) throw new Error(payload.error ?? "Could not read markets.");
        setMarkets(payload.markets);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setMarkets([]);
      });
    return () => controller.abort();
  }, [address]);

  return (
    <div className="inner-page page-shell portfolio-page">
      <div className="page-title">
        <h1>Portfolio</h1>
      </div>

      {!address ? (
        <div className="empty-state compact portfolio-empty">
          <WalletCards />
          <h2>Connect wallet</h2>
          <button className="button-primary" onClick={() => void connect()} type="button">Connect wallet</button>
        </div>
      ) : (
        <ArbitragePortfolio wallet={address} markets={markets} />
      )}
    </div>
  );
}
