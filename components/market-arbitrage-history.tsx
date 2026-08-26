"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { ExternalLink, LoaderCircle, Pause } from "lucide-react";
import { formatUnits } from "viem";
import { ArbitrageWatchHelp } from "@/components/arbitrage-watch-help";
import { useWallet } from "@/components/wallet-provider";
import { tokenLogoUrl } from "@/components/token-logo";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ERC20_PERMISSION_ABI,
  type ContinuousArbitrageExecution,
  type ContinuousArbitrageSnapshot,
  type ContinuousArbitrageStrategy,
  type DirectArbitrageExecutionQuote,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import { compactActionError as compactError } from "@/lib/errors";
import {
  refreshContinuousArbitrageSnapshot,
  useContinuousArbitrageSnapshot,
} from "@/lib/continuous-arbitrage-client";
import type { VerifiedMarket } from "@/lib/onchain-types";

function tokenAmount(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function isLive(
  strategy: ContinuousArbitrageStrategy,
  snapshot: ContinuousArbitrageSnapshot,
) {
  return (
    strategy.active &&
    BigInt(strategy.remainingVolumeRaw) > 0n &&
    (strategy.validUntil === 0 || strategy.validUntil > snapshot.readTimestamp)
  );
}

export function MarketArbitrageHistory({
  market,
  watchReason,
  activeQuote,
}: {
  market: VerifiedMarket;
  watchReason?: string;
  activeQuote?: DirectArbitrageExecutionQuote | null;
}) {
  const wallet = useWallet();
  const snapshotState = useContinuousArbitrageSnapshot(wallet.address);
  const snapshot = snapshotState.snapshot;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [visibleExecutions, setVisibleExecutions] = useState(5);

  const marketStrategies = useMemo(
    () =>
      snapshot?.strategies.filter(
        (strategy) =>
          strategy.hToken.toLowerCase() === market.token.toLowerCase(),
      ) ?? [],
    [market.token, snapshot?.strategies],
  );
  const strategyIds = useMemo(
    () => new Set(marketStrategies.map((strategy) => strategy.id)),
    [marketStrategies],
  );
  const marketExecutions = useMemo(
    () =>
      snapshot?.executions.filter((execution) =>
        strategyIds.has(execution.strategyId),
      ) ?? [],
    [snapshot?.executions, strategyIds],
  );
  const activeStrategy = useMemo(
    () =>
      snapshot
        ? (marketStrategies.find((strategy) => isLive(strategy, snapshot)) ??
          null)
        : null,
    [marketStrategies, snapshot],
  );
  const activeExecutions = useMemo(
    () =>
      marketExecutions.filter(
        (execution) => execution.strategyId === activeStrategy?.id,
      ),
    [activeStrategy?.id, marketExecutions],
  );
  const walletProfitRaw = useCallback(
    (execution: ContinuousArbitrageExecution) =>
      BigInt(execution.ownerProfitReserveRaw) +
      (wallet.address &&
      execution.executor.toLowerCase() === wallet.address.toLowerCase()
        ? BigInt(execution.executorRewardReserveRaw)
        : 0n),
    [wallet.address],
  );
  const activePnlRaw = activeExecutions.reduce(
    (total, execution) => total + walletProfitRaw(execution),
    0n,
  );
  const activeStatus =
    watchReason === "Gas too high." || watchReason === "Waiting for gas."
      ? "Gas wait"
      : "Watching";

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
      const stopReceipt = await publicClient.waitForTransactionReceipt({
        hash: stopHash,
      });
      if (stopReceipt.status !== "success")
        throw new Error("Stop did not confirm.");
      const revokeRequest = await publicClient.simulateContract({
        account: wallet.address,
        address: strategy.reserveToken,
        abi: ERC20_PERMISSION_ABI,
        functionName: "approve",
        args: [snapshot.executor, 0n],
      });
      const revokeHash = await walletClient.writeContract(
        revokeRequest.request,
      );
      const revokeReceipt = await publicClient.waitForTransactionReceipt({
        hash: revokeHash,
      });
      if (revokeReceipt.status !== "success")
        throw new Error(
          "Stopped, but the remaining permission was not removed.",
        );
      await refreshContinuousArbitrageSnapshot(wallet.address);
    } catch (reason) {
      setError(compactError(reason, "Could not stop arbitrage."));
    } finally {
      setBusy("");
    }
  }

  const recentExecutions = marketExecutions.slice(0, visibleExecutions);
  const hasMoreExecutions = marketExecutions.length > recentExecutions.length;

  return (
    <section
      className="market-position-history"
      aria-label={`${market.symbol} arbitrage position history`}
    >
      <div className="market-position-head">
        <div>
          <span className="kicker">3. Position history</span>
        </div>
      </div>

      <div className="market-position-list">
        <div className="market-position-columns" aria-hidden="true">
          <span>Type</span>
          <span>Each run</span>
          <span>Left</span>
          <span>Return</span>
          <span>PnL</span>
          <span>Runs</span>
          <span>Status</span>
          <span>Action</span>
        </div>

        {activeStrategy && snapshot && (
          <article>
            <div className="position-market">
              <Image
                src={tokenLogoUrl(market.token, CHAINS.base.id)}
                alt=""
                width={34}
                height={34}
                unoptimized
              />
              <span>
                <strong>Active</strong>
                <small>#{activeStrategy.id}</small>
              </span>
            </div>
            <strong>
              {tokenAmount(
                activeStrategy.maxReservePerExecutionRaw,
                market.reserveDecimals,
              )}{" "}
              {market.reserveSymbol}
            </strong>
            <strong>
              {tokenAmount(
                activeStrategy.remainingVolumeRaw,
                market.reserveDecimals,
              )}{" "}
              {market.reserveSymbol}
            </strong>
            <strong>—</strong>
            <strong className="positive">
              +{tokenAmount(activePnlRaw.toString(), market.reserveDecimals)}{" "}
              {market.reserveSymbol}
            </strong>
            <strong>{activeStrategy.executionCount}</strong>
            <span className="position-status">
              <strong>{activeStatus}</strong>
              <ArbitrageWatchHelp
                reason={watchReason ?? ""}
                quote={activeQuote ?? null}
                reserveSymbol={market.reserveSymbol}
                reserveDecimals={market.reserveDecimals}
              />
            </span>
            <div className="position-actions">
              <button
                disabled={Boolean(busy)}
                onClick={() => void stop(activeStrategy)}
                type="button"
              >
                {busy === activeStrategy.id ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Pause />
                )}{" "}
                Stop
              </button>
            </div>
          </article>
        )}

        {recentExecutions.map((execution: ContinuousArbitrageExecution) => (
          <a
            href={`${CHAINS.base.explorerUrl}/tx/${execution.transactionHash}`}
            target="_blank"
            rel="noreferrer"
            key={`${execution.transactionHash}-${execution.strategyId}`}
          >
            <div className="position-market">
              <Image
                src={tokenLogoUrl(market.token, CHAINS.base.id)}
                alt=""
                width={34}
                height={34}
                unoptimized
              />
              <span>
                <strong>Run</strong>
                <small>{execution.direction}</small>
              </span>
            </div>
            <strong>
              {tokenAmount(
                execution.amountInReserveRaw,
                market.reserveDecimals,
              )}{" "}
              {market.reserveSymbol}
            </strong>
            <strong>—</strong>
            <strong>
              {tokenAmount(
                execution.amountReturnedReserveRaw,
                market.reserveDecimals,
              )}{" "}
              {market.reserveSymbol}
            </strong>
            <strong className="positive">
              +
              {tokenAmount(
                walletProfitRaw(execution).toString(),
                market.reserveDecimals,
              )}{" "}
              {market.reserveSymbol}
            </strong>
            <strong>{execution.executionCount}</strong>
            <strong>Executed</strong>
            <span className="position-actions">
              <ExternalLink />
            </span>
          </a>
        ))}

        {!wallet.address && (
          <div className="market-position-empty">
            <span>Connect wallet</span>
          </div>
        )}
        {wallet.address && !activeStrategy && recentExecutions.length === 0 && (
          <div className="market-position-empty">
            <span>No positions</span>
          </div>
        )}
      </div>

      {hasMoreExecutions && (
        <button
          className="market-position-more"
          onClick={() => setVisibleExecutions((value) => value + 5)}
          type="button"
        >
          Show more
        </button>
      )}
      {(error || snapshotState.error) && (
        <p className="market-position-error">{error || snapshotState.error}</p>
      )}
    </section>
  );
}
