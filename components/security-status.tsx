"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { ChainBadge } from "@/components/chain-badge";
import { useWallet } from "@/components/wallet-provider";
import { CHAINS, type ChainKey } from "@/lib/chains";
import { shortAddress } from "@/lib/format";

type Health = {
  chain: ChainKey;
  chainId: number;
  blockNumber: string;
  readAt: string;
  contracts: { name: string; address: `0x${string}`; deployed: boolean }[];
};

export function SecurityStatus() {
  const wallet = useWallet();
  const [health, setHealth] = useState<Health[]>([]);
  const [unavailableChains, setUnavailableChains] = useState<ChainKey[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    // The loading flag belongs to this external contract-health request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    setError("");
    fetch("/api/security", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { health?: Health[]; unavailableChains?: ChainKey[]; error?: string };
        if (!response.ok || !payload.health) throw new Error(payload.error ?? "Verification failed.");
        setHealth(payload.health);
        setUnavailableChains(payload.unavailableChains ?? []);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Verification failed.");
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  const allDeployed = health.length > 0 && unavailableChains.length === 0 && health.every((network) => network.contracts.every((contract) => contract.deployed));
  const walletSupported = wallet.address ? Boolean(wallet.chainKey) : null;

  return (
    <div className="inner-page page-shell security-page">
      <div className="page-title"><span className="kicker">Live verification</span><h1>Security</h1><p>Your wallet keeps control. Every transaction is checked before you sign.</p></div>
      <div className="security-principle">
        {busy ? <LoaderCircle className="spin" /> : allDeployed ? <ShieldCheck /> : <AlertTriangle />}
        <div><span>System status</span><h2>{allDeployed ? "Verified onchain." : "Verification incomplete."}</h2><p>{busy ? "Checking the live contracts." : error ? error : allDeployed ? "The contracts used by GETHYPED are deployed on their declared networks." : "One or more network reads or contract checks could not be completed."}</p></div>
      </div>
      {unavailableChains.length > 0 && <p className="partial-note">Some network checks are temporarily unavailable. Completed verifications remain visible.</p>}
      {health.length > 0 && (
        <details className="deployment-list security-details">
          <summary>View verified contracts</summary>
          {health.flatMap((network) => network.contracts.map((contract) => (
            <a href={`${CHAINS[network.chain].explorerUrl}/address/${contract.address}`} key={`${network.chain}-${contract.address}`} target="_blank" rel="noreferrer">
              {contract.deployed ? <CheckCircle2 className="ok" /> : <XCircle className="failed" />}
              <span><strong>{contract.name} <ChainBadge chain={network.chain} className="inline" /></strong><small>{shortAddress(contract.address)} · block {network.blockNumber}</small></span>
              <b>{contract.deployed ? "Code found" : "Missing"}</b><ExternalLink />
            </a>
          )))}
        </details>
      )}
      <section className="security-controls">
        <div className="section-heading small"><div><h2>What protects you</h2></div></div>
        <div className="live-check-grid">
          <article><span>Your funds</span><strong>Stay in your wallet</strong><small>GETHYPED has no server key that can move them.</small></article>
          <article><span>Your limit</span><strong>Exact, never unlimited</strong><small>The executor can use it once, then the strategy ends.</small></article>
          <article><span>Your transaction</span><strong>Protected by simulation</strong><small>An execution that misses the minimum return reverts.</small></article>
        </div>
        {wallet.address && <p className="source-note">Connected wallet · {shortAddress(wallet.address)} · {walletSupported ? "Supported network" : "Check network"}</p>}
      </section>
      <div className="alert warning security-disclaimer"><AlertTriangle /><div><strong>ERC-20 metadata does not prove transfer behavior</strong><p>GETHYPED can create a backed Hyped Token without claiming that transfer-tax, rebase or blacklist behavior is safe. Backing movement and liquidity transactions require a separate simulation.</p></div></div>
      {health.length > 0 && <p className="source-note">Source · Contract bytecode across supported networks · Live read</p>}
    </div>
  );
}
