"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, LoaderCircle, Pause, ShieldCheck } from "lucide-react";
import { formatEther, formatUnits, type Address } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { tokenLogoUrl } from "@/components/token-logo";
import {
  ARBITRAGE_EXECUTOR_ABI,
  ARBITRAGE_EXECUTOR_V2_ABI,
  ARBITRAGE_EXECUTOR_V3_ABI,
  ERC20_PERMISSION_ABI,
  type ArbitrageSnapshot,
  type ContinuousArbitrageSnapshot,
  type ReserveArbitrageSnapshot,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import { compact, shortAddress } from "@/lib/format";
import type { VerifiedMarket } from "@/lib/onchain-types";

function tokenAmount(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  if (value > 0 && value < 0.001) return value.toLocaleString("en-US", { maximumFractionDigits: 9 });
  return compact(value);
}

function wethAmount(raw: string) {
  const value = Number(formatEther(BigInt(raw)));
  if (value > 0 && value < 0.001) return value.toLocaleString("en-US", { maximumFractionDigits: 9 });
  return compact(value);
}

function marketFor(markets: VerifiedMarket[], hToken: Address) {
  return markets.find((market) => market.chain === "base" && market.token.toLowerCase() === hToken.toLowerCase());
}

function actionError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason || fallback);
  if (/over rate limit|rate.?limit|too many requests|429/i.test(message)) return "Base RPC is busy. Wait a moment and try again.";
  if (/rpc request failed|http request failed|failed to fetch|network request/i.test(message)) return "The Base read was interrupted. Try again.";
  return message;
}

export function ArbitragePortfolio({ wallet, markets }: { wallet: Address; markets: VerifiedMarket[] }) {
  const walletState = useWallet();
  const [continuous, setContinuous] = useState<ContinuousArbitrageSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<ReserveArbitrageSnapshot | null>(null);
  const [legacy, setLegacy] = useState<ArbitrageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const [continuousResponse, nextResponse, legacyResponse] = await Promise.all([
      fetch(`/api/arbitrage/v3?wallet=${wallet}`, { cache: "no-store" }),
      fetch(`/api/arbitrage/v2?wallet=${wallet}`, { cache: "no-store" }),
      fetch(`/api/arbitrage?wallet=${wallet}`, { cache: "no-store" }),
    ]);
    const [continuousPayload, nextPayload, legacyPayload] = await Promise.all([
      continuousResponse.json() as Promise<{ snapshot?: ContinuousArbitrageSnapshot; error?: string }>,
      nextResponse.json() as Promise<{ snapshot?: ReserveArbitrageSnapshot; error?: string }>,
      legacyResponse.json() as Promise<{ snapshot?: ArbitrageSnapshot; error?: string }>,
    ]);
    if (!continuousResponse.ok || !continuousPayload.snapshot) throw new Error(continuousPayload.error ?? "Could not read arbitrage.");
    setContinuous(continuousPayload.snapshot);
    if (nextResponse.ok && nextPayload.snapshot) setSnapshot(nextPayload.snapshot);
    if (legacyResponse.ok && legacyPayload.snapshot) setLegacy(legacyPayload.snapshot);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/arbitrage/v3?wallet=${wallet}`, { cache: "no-store" }),
      fetch(`/api/arbitrage/v2?wallet=${wallet}`, { cache: "no-store" }),
      fetch(`/api/arbitrage?wallet=${wallet}`, { cache: "no-store" }),
    ])
      .then(async ([continuousResponse, nextResponse, legacyResponse]) => {
        const [continuousPayload, nextPayload, legacyPayload] = await Promise.all([
          continuousResponse.json() as Promise<{ snapshot?: ContinuousArbitrageSnapshot; error?: string }>,
          nextResponse.json() as Promise<{ snapshot?: ReserveArbitrageSnapshot; error?: string }>,
          legacyResponse.json() as Promise<{ snapshot?: ArbitrageSnapshot; error?: string }>,
        ]);
        if (!continuousResponse.ok || !continuousPayload.snapshot) throw new Error(continuousPayload.error ?? "Could not read arbitrage.");
        if (!active) return;
        setContinuous(continuousPayload.snapshot);
        if (nextResponse.ok && nextPayload.snapshot) setSnapshot(nextPayload.snapshot);
        if (legacyResponse.ok && legacyPayload.snapshot) setLegacy(legacyPayload.snapshot);
      })
      .catch((reason) => {
        if (active) setError(actionError(reason, "Could not read arbitrage."));
      });
    return () => { active = false; };
  }, [wallet]);

  const activeStrategies = useMemo(() => continuous?.strategies.filter((item) => item.active && BigInt(item.remainingVolumeRaw) > 0n && (item.validUntil === 0 || item.validUntil > (continuous.readTimestamp ?? 0))) ?? [], [continuous]);
  const activeV2 = useMemo(() => snapshot?.strategies.filter((item) => item.active && item.validUntil > (snapshot.readTimestamp ?? 0)) ?? [], [snapshot]);
  const activeLegacy = useMemo(() => legacy?.strategies.filter((item) => item.active && item.validUntil > (legacy.readTimestamp ?? 0)) ?? [], [legacy]);

  async function stopContinuous(strategyId: string, reserveToken: Address) {
    if (!continuous?.executor) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const publicClient = await walletState.getPublicClient("base");
      const walletClient = await walletState.getWalletClient("base");
      const stopping = await publicClient.simulateContract({ account: wallet, address: continuous.executor, abi: ARBITRAGE_EXECUTOR_V3_ABI, functionName: "stopStrategy", args: [BigInt(strategyId)] });
      const stopHash = await walletClient.writeContract(stopping.request);
      const stopReceipt = await publicClient.waitForTransactionReceipt({ hash: stopHash });
      if (stopReceipt.status !== "success") throw new Error("Stop did not confirm.");
      const revoke = await publicClient.simulateContract({ account: wallet, address: reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "approve", args: [continuous.executor, 0n] });
      const revokeHash = await walletClient.writeContract(revoke.request);
      const revokeReceipt = await publicClient.waitForTransactionReceipt({ hash: revokeHash });
      if (revokeReceipt.status !== "success") throw new Error("Arbitrage stopped, but the remaining token permission was not removed.");
      setMessage("Arbitrage stopped and its token permission was removed.");
      await refresh();
    } catch (reason) {
      setError(actionError(reason, "Could not stop arbitrage."));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function stopV2(strategyId: string, reserveToken: Address) {
    if (!snapshot?.executor) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const publicClient = await walletState.getPublicClient("base");
      const walletClient = await walletState.getWalletClient("base");
      const stopping = await publicClient.simulateContract({ account: wallet, address: snapshot.executor, abi: ARBITRAGE_EXECUTOR_V2_ABI, functionName: "stopStrategy", args: [BigInt(strategyId)] });
      const stopHash = await walletClient.writeContract(stopping.request);
      const stopReceipt = await publicClient.waitForTransactionReceipt({ hash: stopHash });
      if (stopReceipt.status !== "success") throw new Error("Stop did not confirm.");
      const revoke = await publicClient.simulateContract({ account: wallet, address: reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "approve", args: [snapshot.executor, 0n] });
      const revokeHash = await walletClient.writeContract(revoke.request);
      const revokeReceipt = await publicClient.waitForTransactionReceipt({ hash: revokeHash });
      if (revokeReceipt.status !== "success") throw new Error("Arbitrage stopped, but the remaining token permission was not removed.");
      setMessage("Arbitrage stopped and its Reserve Token permission was removed.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not stop arbitrage.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function stopLegacy(strategyId: string) {
    if (!legacy?.executor) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const publicClient = await walletState.getPublicClient("base");
      const walletClient = await walletState.getWalletClient("base");
      const stopping = await publicClient.simulateContract({ account: wallet, address: legacy.executor, abi: ARBITRAGE_EXECUTOR_ABI, functionName: "stopStrategy", args: [BigInt(strategyId)] });
      const stopHash = await walletClient.writeContract(stopping.request);
      const stopReceipt = await publicClient.waitForTransactionReceipt({ hash: stopHash });
      if (stopReceipt.status !== "success") throw new Error("Legacy stop did not confirm.");
      const remaining = activeLegacy.some((item) => item.id !== strategyId);
      if (!remaining) {
        const revoke = await publicClient.simulateContract({ account: wallet, address: CHAINS.base.weth, abi: ERC20_PERMISSION_ABI, functionName: "approve", args: [legacy.executor, 0n] });
        const revokeHash = await walletClient.writeContract(revoke.request);
        const revokeReceipt = await publicClient.waitForTransactionReceipt({ hash: revokeHash });
        if (revokeReceipt.status !== "success") throw new Error("Legacy route stopped, but its WETH permission was not removed.");
      }
      setMessage(remaining ? "Legacy arbitrage stopped." : "Legacy arbitrage and its WETH permission were removed.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not stop legacy arbitrage.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!continuous) return <div className="empty-state compact"><LoaderCircle className="spin" /><h2>Reading arbitrage</h2><p>Only confirmed contract state is shown.</p></div>;

  if (!continuous.configured) return <section className="automation-unavailable"><ShieldCheck /><div><span className="kicker">Arbitrage</span><h2>Arbitrage is not live on Base yet.</h2><p>No wallet permission is requested until the V3 executor is deployed and verified.</p></div></section>;

  return (
    <div className="automation-page">
      <section className="automation-stats">
        <div><span>Watching</span><strong>{activeStrategies.length}</strong><small>Reserve Token routes</small></div>
        <div><span>Completed</span><strong>{continuous.executions.length}</strong><small>Successful executions</small></div>
        <div><span>Settlement</span><strong>Reserve</strong><small>Principal and profit return in the OG token</small></div>
      </section>

      <section className="automation-list-section">
        <div className="section-heading"><h2>Arbitrage</h2><span>Each active route uses only its approved Reserve Token amount.</span></div>
        {continuous.strategies.length ? <div className="automation-list">{continuous.strategies.map((strategy) => {
          const market = marketFor(markets, strategy.hToken);
          const live = strategy.active && BigInt(strategy.remainingVolumeRaw) > 0n && (strategy.validUntil === 0 || strategy.validUntil > continuous.readTimestamp);
          const decimals = market?.reserveDecimals ?? 18;
          const symbol = market?.reserveSymbol ?? "Reserve";
          return <article key={strategy.id}>
            <div className="automation-market"><Image src={tokenLogoUrl(strategy.hToken, CHAINS.base.id)} alt="" width={38} height={38} unoptimized /><span><strong>{market ? `${market.reserveSymbol} ↔ ${market.symbol}` : shortAddress(strategy.hToken)}</strong><small>{tokenAmount(strategy.remainingVolumeRaw, decimals)} {symbol} left</small></span></div>
            <span className={live ? "automation-live" : "automation-off"}>{live ? "Watching" : strategy.active ? "Expired" : "Stopped"}</span>
            <time>{strategy.validUntil === 0 ? `${strategy.executionCount} executions` : new Date(strategy.validUntil * 1000).toLocaleString("en-US")}</time>
            {live ? <button disabled={busy} onClick={() => void stopContinuous(strategy.id, strategy.reserveToken)} type="button"><Pause /> Stop</button> : market ? <Link className="automation-row-link" href={`/market/base/${market.token}`}>Open <ArrowRight /></Link> : null}
          </article>;
        })}</div> : <div className="empty-state compact"><ShieldCheck /><h2>No arbitrage yet.</h2><p>Open a supported market, check the live return, and execute from there.</p></div>}
      </section>

      {message && <div className="automation-message"><CheckCircle2 /><span>{message}</span></div>}
      {error && <div className="alert danger"><ShieldCheck /><div><strong>Action not completed</strong><p>{error}</p></div></div>}

      <section className="automation-list-section">
        <div className="section-heading"><h2>Reserve profit history</h2><span>Amounts are never combined across different tokens.</span></div>
        {continuous.executions.length ? <div className="automation-history">{continuous.executions.map((execution) => {
          const strategy = continuous.strategies.find((item) => item.id === execution.strategyId);
          const market = strategy ? marketFor(markets, strategy.hToken) : undefined;
          const decimals = market?.reserveDecimals ?? 18;
          const symbol = market?.reserveSymbol ?? "Reserve";
          return <a href={`${CHAINS.base.explorerUrl}/tx/${execution.transactionHash}`} target="_blank" rel="noreferrer" key={`${execution.transactionHash}-${execution.strategyId}`}><div><strong>+{tokenAmount(execution.ownerProfitReserveRaw, decimals)} {symbol}</strong><small>{execution.direction}</small></div><span>{tokenAmount(execution.amountInReserveRaw, decimals)} {symbol} used</span><b>Block {execution.blockNumber}</b><ExternalLink /></a>;
        })}</div> : <div className="empty-state compact"><ShieldCheck /><h2>No completed route.</h2><p>Failed or unprofitable attempts revert and do not appear as completed routes.</p></div>}
      </section>

      {(activeV2.length > 0 || (snapshot?.executions.length ?? 0) > 0) && <section className="automation-list-section legacy-arbitrage">
        <div className="section-heading"><h2>Previous one-time permissions</h2><span>Earlier 24-hour permissions are kept here so they can be stopped or reviewed.</span></div>
        {activeV2.length > 0 && <div className="automation-list">{activeV2.map((strategy) => {
          const market = marketFor(markets, strategy.hToken);
          const decimals = market?.reserveDecimals ?? 18;
          const symbol = market?.reserveSymbol ?? "Reserve";
          return <article key={strategy.id}><div className="automation-market"><Image src={tokenLogoUrl(strategy.hToken, CHAINS.base.id)} alt="" width={38} height={38} unoptimized /><span><strong>{market ? `${market.reserveSymbol} ↔ ${market.symbol}` : shortAddress(strategy.hToken)}</strong><small>Earlier one-time permission · {tokenAmount(strategy.maxReservePerExecutionRaw, decimals)} {symbol}</small></span></div><span className="automation-live">One-time</span><time>{new Date(strategy.validUntil * 1000).toLocaleString("en-US")}</time><button disabled={busy} onClick={() => void stopV2(strategy.id, strategy.reserveToken)} type="button"><Pause /> Stop and revoke</button></article>;
        })}</div>}
        {(snapshot?.executions.length ?? 0) > 0 && <details className="legacy-history"><summary>Earlier one-time profit history</summary><div className="automation-history">{snapshot?.executions.map((execution) => {
          const strategy = snapshot.strategies.find((item) => item.id === execution.strategyId);
          const market = strategy ? marketFor(markets, strategy.hToken) : undefined;
          const decimals = market?.reserveDecimals ?? 18;
          const symbol = market?.reserveSymbol ?? "Reserve";
          return <a href={`${CHAINS.base.explorerUrl}/tx/${execution.transactionHash}`} target="_blank" rel="noreferrer" key={`${execution.transactionHash}-${execution.strategyId}`}><div><strong>+{tokenAmount(execution.ownerProfitReserveRaw, decimals)} {symbol}</strong><small>{execution.direction}</small></div><span>{tokenAmount(execution.amountInReserveRaw, decimals)} {symbol} used</span><b>Block {execution.blockNumber}</b><ExternalLink /></a>;
        })}</div></details>}
      </section>}

      {(activeLegacy.length > 0 || (legacy?.executions.length ?? 0) > 0) && <section className="automation-list-section legacy-arbitrage">
        <div className="section-heading"><h2>Legacy WETH permissions</h2><span>Kept only so earlier permissions can be stopped or reviewed.</span></div>
        {activeLegacy.length > 0 && <div className="automation-list">{activeLegacy.map((strategy) => {
          const market = marketFor(markets, strategy.hToken);
          return <article key={strategy.id}><div className="automation-market"><Image src={tokenLogoUrl(strategy.hToken, CHAINS.base.id)} alt="" width={38} height={38} unoptimized /><span><strong>{market ? `${market.reserveSymbol} ↔ ${market.symbol}` : shortAddress(strategy.hToken)}</strong><small>Earlier WETH-settled permission</small></span></div><span className="automation-live">Legacy</span><time>{new Date(strategy.validUntil * 1000).toLocaleString("en-US")}</time><button disabled={busy} onClick={() => void stopLegacy(strategy.id)} type="button"><Pause /> Stop and revoke</button></article>;
        })}</div>}
        {(legacy?.executions.length ?? 0) > 0 && <details className="legacy-history"><summary>Earlier WETH profit history</summary><div className="automation-history">{legacy?.executions.map((execution) => <a href={`${CHAINS.base.explorerUrl}/tx/${execution.transactionHash}`} target="_blank" rel="noreferrer" key={`${execution.transactionHash}-${execution.strategyId}`}><div><strong>+{wethAmount(execution.ownerProfitRaw)} WETH</strong><small>{execution.direction}</small></div><span>{wethAmount(execution.amountInRaw)} WETH used</span><b>Block {execution.blockNumber}</b><ExternalLink /></a>)}</div></details>}
      </section>}
    </div>
  );
}
