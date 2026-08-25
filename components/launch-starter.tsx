"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Coins, LoaderCircle, Search } from "lucide-react";
import { isAddress } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { CHAINS } from "@/lib/chains";
import { createManifest, saveManifest } from "@/lib/manifest";
import type { TrendingToken } from "@/lib/trending";
import type { TokenAnalysis } from "@/lib/types";

function formatChange(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function LaunchStarter({ trendingTokens }: { trendingTokens: TrendingToken[] }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<TokenAnalysis[]>([]);

  function continueWith(analysis: TokenAnalysis) {
    const manifest = saveManifest(createManifest(analysis));
    router.push(`/launch/${manifest.id}`);
  }

  async function analyzeToken(tokenAddress: string, chain?: TrendingToken["chain"]) {
    setError("");
    if (!isAddress(tokenAddress.trim())) {
      setError("Enter a valid OG token contract address.");
      return;
    }
    setBusy(true);
    setMatches([]);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenAddress, chain }),
      });
      const payload = (await response.json()) as { analyses?: TokenAnalysis[]; error?: string };
      if (!response.ok || !payload.analyses?.length) throw new Error(payload.error ?? "Analysis failed.");
      if (payload.analyses.length === 1) continueWith(payload.analyses[0]);
      else setMatches(payload.analyses);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await analyzeToken(address.trim());
  }

  async function chooseTrending(token: TrendingToken) {
    setAddress(token.address);
    await analyzeToken(token.address, token.chain);
  }

  return (
    <div className="launch-box">
      <form onSubmit={submit}>
        <label htmlFor="token-address">OG token</label>
        <div className="address-input">
          <Search size={19} />
          <input
            id="token-address"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setError("");
              setMatches([]);
            }}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
          />
          <button disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={18} /> : <>Create a pool <ArrowRight size={17} /></>}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
      {matches.length > 1 && <div className="network-match-list compact" aria-label="Matching token contracts">{matches.map((analysis) => <button key={analysis.chain} type="button" onClick={() => continueWith(analysis)}><ChainBadge chain={analysis.chain} /><span><strong>{analysis.symbol}</strong><small>{CHAINS[analysis.chain].name}</small></span><ArrowRight /></button>)}</div>}
      {trendingTokens.length > 0 && (
        <section className="trending-tokens" aria-labelledby="trending-title">
          <div className="trending-tokens-head">
            <div><strong id="trending-title">Trending now</strong><small>Choose a token to start</small></div>
            <span>Base + Robinhood</span>
          </div>
          <div className="trending-token-grid">
            {trendingTokens.map((token) => (
              <button
                className="trending-token-card"
                disabled={busy}
                key={`${token.chain}-${token.address}`}
                onClick={() => void chooseTrending(token)}
                type="button"
              >
                <span className="trending-token-logo">
                  {token.imageUrl ? <Image src={token.imageUrl} alt={`${token.symbol} token logo`} width={38} height={38} unoptimized /> : <Coins aria-label="Token logo unavailable" />}
                  <ChainBadge chain={token.chain} />
                </span>
                <span className="trending-token-name"><strong>{token.symbol}</strong><small>{token.name}</small></span>
                <b className={token.priceChange24h !== null && token.priceChange24h < 0 ? "negative" : "positive"}>{formatChange(token.priceChange24h)}</b>
              </button>
            ))}
          </div>
          <p className="trending-source">24h movers from GeckoTerminal · Server-cached for 10 minutes</p>
        </section>
      )}
    </div>
  );
}
