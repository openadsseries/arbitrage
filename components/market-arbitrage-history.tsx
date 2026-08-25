"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, LoaderCircle, Pause } from "lucide-react";
import { formatUnits } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { tokenLogoUrl } from "@/components/token-logo";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ERC20_PERMISSION_ABI,
  type ContinuousArbitrageExecution,
  type ContinuousArbitrageSnapshot,
  type ContinuousArbitrageStrategy,
  type ReserveArbitrageExecution,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import { compactActionError as compactError } from "@/lib/errors";
import type { VerifiedMarket } from "@/lib/onchain-types";

function tokenAmount(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function isLive(strategy: ContinuousArbitrageStrategy, snapshot: ContinuousArbitrageSnapshot) {
  return strategy.active
    && BigInt(strategy.remainingVolumeRaw) > 0n
    && (strategy.validUntil === 0 || strategy.validUntil > snapshot.readTimestamp);
}

export function MarketArbitrageHistory({
  market,
  latestExecution,
  refreshSignal,
}: {
  market: VerifiedMarket;
  latestExecution: ReserveArbitrageExecution | null;
  refreshSignal: number;
}) {
  const wallet = useWallet();
  const [snapshot, setSnapshot] = useState<ContinuousArbitrageSnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [visibleExecutions, setVisibleExecutions] = useState(5);

  const refresh = useCallback(async () => {
    if (!wallet.address) {
      setSnapshot(null);
      return;
    }
    const response = await fetch(`/api/arbitrage/v3?wallet=${wallet.address}`, { cache: "no-store" });
    const payload = await response.json() as { snapshot?: ContinuousArbitrageSnapshot; error?: string };
    if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "Could not read arbitrage.");
    setSnapshot(payload.snapshot);
  }, [wallet.address]);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      refresh().catch((reason) => {
        if (active) setError(compactError(reason, "Could not read arbitrage."));
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [latestExecution, refresh, refreshSignal]);

  useEffect(() => {
    if (!wallet.address) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh().catch((reason) => setError(compactError(reason, "Could not read arbitrage.")));
      }
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh, wallet.address]);

  const marketStrategies = useMemo(() => snapshot?.strategies.filter(
    (strategy) => strategy.hToken.toLowerCase() === market.token.toLowerCase(),
  ) ?? [], [market.token, snapshot?.strategies]);
  const strategyIds = useMemo(() => new Set(marketStrategies.map((strategy) => strategy.id)), [marketStrategies]);
  const marketExecutions = useMemo(() => snapshot?.executions.filter(
    (execution) => strategyIds.has(execution.strategyId),
  ) ?? [], [snapshot?.executions, strategyIds]);
  const activeStrategy = useMemo(() => snapshot
    ? marketStrategies.find((strategy) => isLive(strategy, snapshot)) ?? null
    : null, [marketStrategies, snapshot]);
  const activeExecutions = useMemo(() => marketExecutions.filter(
    (execution) => execution.strategyId === activeStrategy?.id,
  ), [activeStrategy?.id, marketExecutions]);
  const walletProfitRaw = useCallback((execution: ContinuousArbitrageExecution) => (
    BigInt(execution.ownerProfitReserveRaw) + (
      wallet.address && execution.executor.toLowerCase() === wallet.address.toLowerCase()
        ? BigInt(execution.executorRewardReserveRaw)
        : 0n
    )
  ), [wallet.address]);
  const activePnlRaw = activeExecutions.reduce(
    (total, execution) => total + walletProfitRaw(execution),
    0n,
  );

  async function stop(strategy: ContinuousArbitrageStrategy) {
    if (!wallet.address || !snapshot?.executor) return;
    setBusy(strategy.id);
    setError("");
    try {
      const publicClient = await wallet.getPublicClient("base");
      const walletClient = await wallet.getWalletClient("base");
      const stopRequest = await publicClient.simulateContract({
        account: wallet.address,
        address: snapshot.executor,
        abi: ARBITRAGE_EXECUTOR_V3_ABI,
        functionName: "stopStrategy",
        args: [BigInt(strategy.id)],
      });
      const stopHash = await walletClient.writeContract(stopRequest.request);
      const stopReceipt = await publicClient.waitForTransactionReceipt({ hash: stopHash });
      if (stopReceipt.status !== "success") throw new Error("Stop did not confirm.");
      const revokeRequest = await publicClient.simulateContract({
        account: wallet.address,
        address: strategy.reserveToken,
        abi: ERC20_PERMISSION_ABI,
        functionName: "approve",
        args: [snapshot.executor, 0n],
      });
      const revokeHash = await walletClient.writeContract(revokeRequest.request);
      const revokeReceipt = await publicClient.waitForTransactionReceipt({ hash: revokeHash });
      if (revokeReceipt.status !== "success") throw new Error("Stopped, but the remaining permission was not removed.");
      await refresh();
    } catch (reason) {
      setError(compactError(reason, "Could not stop arbitrage."));
    } finally {
      setBusy("");
    }
  }

  const recentExecutions = marketExecutions.slice(0, visibleExecutions);
  const hasMoreExecutions = marketExecutions.length > recentExecutions.length;

  return (
    <section className="market-position-history" aria-label={`${market.symbol} arbitrage position history`}>
      <div className="market-position-head">
        <div>
          <span className="kicker">3. Position history</span>
        </div>
      </div>

      <div className="market-position-list">
        <div className="market-position-columns" aria-hidden="true">
          <span>Type</span>
          <span>Size</span>
          <span>Return</span>
          <span>PnL</span>
          <span>Status</span>
          <span>Action</span>
        </div>

        {activeStrategy && snapshot && (
          <article>
            <div className="position-market">
              <Image src={tokenLogoUrl(market.token, CHAINS.base.id)} alt="" width={34} height={34} unoptimized />
              <span><strong>Watching</strong><small>#{activeStrategy.id}</small></span>
            </div>
            <strong>{tokenAmount(activeStrategy.remainingVolumeRaw, market.reserveDecimals)} {market.reserveSymbol}</strong>
            <strong>—</strong>
            <strong className="positive">+{tokenAmount(activePnlRaw.toString(), market.reserveDecimals)} {market.reserveSymbol}</strong>
            <strong>Waiting</strong>
            <div className="position-actions">
              <button disabled={Boolean(busy)} onClick={() => void stop(activeStrategy)} type="button">
                {busy === activeStrategy.id ? <LoaderCircle className="spin" /> : <Pause />} Stop
              </button>
            </div>
          </article>
        )}

        {recentExecutions.map((execution: ContinuousArbitrageExecution) => (
          <a href={`${CHAINS.base.explorerUrl}/tx/${execution.transactionHash}`} target="_blank" rel="noreferrer" key={`${execution.transactionHash}-${execution.strategyId}`}>
            <div className="position-market">
              <Image src={tokenLogoUrl(market.token, CHAINS.base.id)} alt="" width={34} height={34} unoptimized />
              <span><strong>Filled</strong><small>{execution.direction}</small></span>
            </div>
            <strong>{tokenAmount(execution.amountInReserveRaw, market.reserveDecimals)} {market.reserveSymbol}</strong>
            <strong>{tokenAmount(execution.amountReturnedReserveRaw, market.reserveDecimals)} {market.reserveSymbol}</strong>
            <strong className="positive">+{tokenAmount(walletProfitRaw(execution).toString(), market.reserveDecimals)} {market.reserveSymbol}</strong>
            <strong>Executed</strong>
            <span className="position-actions"><ExternalLink /></span>
          </a>
        ))}

        {!wallet.address && <div className="market-position-empty"><span>Connect wallet</span></div>}
        {wallet.address && !activeStrategy && recentExecutions.length === 0 && <div className="market-position-empty"><span>No positions</span></div>}
      </div>

      {hasMoreExecutions && (
        <button className="market-position-more" onClick={() => setVisibleExecutions((value) => value + 5)} type="button">
          Show more
        </button>
      )}
      {error && <p className="market-position-error">{error}</p>}
    </section>
  );
}
