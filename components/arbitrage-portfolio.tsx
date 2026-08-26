"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Pause,
  ShieldCheck,
} from "lucide-react";
import { formatUnits, type Address } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { tokenLogoUrl } from "@/components/token-logo";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ERC20_PERMISSION_ABI,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";
import { compactActionError as actionError } from "@/lib/errors";
import {
  refreshContinuousArbitrageSnapshot,
  useContinuousArbitrageSnapshot,
} from "@/lib/continuous-arbitrage-client";
import { compact, shortAddress } from "@/lib/format";
import type { VerifiedMarket } from "@/lib/onchain-types";

function tokenAmount(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  if (value > 0 && value < 0.001)
    return value.toLocaleString("en-US", { maximumFractionDigits: 9 });
  return compact(value);
}

function signedTokenAmount(raw: bigint, decimals: number) {
  const prefix = raw > 0n ? "+" : "";
  return `${prefix}${tokenAmount(raw.toString(), decimals)}`;
}

function marketFor(markets: VerifiedMarket[], hToken: Address) {
  return markets.find(
    (market) =>
      market.chain === "base" &&
      market.token.toLowerCase() === hToken.toLowerCase(),
  );
}

export function ArbitragePortfolio({
  wallet,
  markets,
}: {
  wallet: Address;
  markets: VerifiedMarket[];
}) {
  const walletState = useWallet();
  const snapshotState = useContinuousArbitrageSnapshot(wallet);
  const continuous = snapshotState.snapshot;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    await refreshContinuousArbitrageSnapshot(wallet);
  }

  const activeStrategies = useMemo(
    () =>
      continuous?.strategies.filter(
        (item) =>
          item.active &&
          BigInt(item.remainingVolumeRaw) > 0n &&
          (item.validUntil === 0 ||
            item.validUntil > (continuous.readTimestamp ?? 0)),
      ) ?? [],
    [continuous],
  );
  const totalPnl = useMemo(() => {
    const groups = new Map<
      string,
      { raw: bigint; decimals: number; symbol: string }
    >();
    if (!continuous) return [];
    for (const execution of continuous.executions) {
      const strategy = continuous.strategies.find(
        (item) => item.id === execution.strategyId,
      );
      const market = strategy ? marketFor(markets, strategy.hToken) : undefined;
      const reserveToken = strategy?.reserveToken ?? execution.reserveToken;
      const key = reserveToken.toLowerCase();
      const current = groups.get(key) ?? {
        raw: 0n,
        decimals: market?.reserveDecimals ?? 18,
        symbol: market?.reserveSymbol ?? "Reserve",
      };
      current.raw +=
        BigInt(execution.ownerProfitReserveRaw) +
        (execution.executor.toLowerCase() === wallet.toLowerCase()
          ? BigInt(execution.executorRewardReserveRaw)
          : 0n);
      groups.set(key, current);
    }
    return [...groups.values()];
  }, [continuous, markets, wallet]);
  const totalPnlLabel = totalPnl.length
    ? totalPnl
        .map(
          (item) =>
            `${signedTokenAmount(item.raw, item.decimals)} ${item.symbol}`,
        )
        .join(" · ")
    : "0";

  async function stopContinuous(strategyId: string, reserveToken: Address) {
    if (!continuous?.executor) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const publicClient = await walletState.getPublicClient("base");
      const walletClient = await walletState.getWalletClient("base");
      const stopping = await publicClient.simulateContract({
        account: wallet,
        address: continuous.executor,
        abi: ARBITRAGE_EXECUTOR_V3_ABI,
        functionName: "stopStrategy",
        args: [BigInt(strategyId)],
      });
      const stopHash = await walletClient.writeContract(stopping.request);
      const stopReceipt = await publicClient.waitForTransactionReceipt({
        hash: stopHash,
      });
      if (stopReceipt.status !== "success")
        throw new Error("Stop did not confirm.");
      const revoke = await publicClient.simulateContract({
        account: wallet,
        address: reserveToken,
        abi: ERC20_PERMISSION_ABI,
        functionName: "approve",
        args: [continuous.executor, 0n],
      });
      const revokeHash = await walletClient.writeContract(revoke.request);
      const revokeReceipt = await publicClient.waitForTransactionReceipt({
        hash: revokeHash,
      });
      if (revokeReceipt.status !== "success")
        throw new Error("Permission was not removed.");
      setMessage("Stopped.");
      await refresh();
    } catch (reason) {
      setError(actionError(reason, "Could not stop arbitrage."));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!continuous)
    return (
      <div className="empty-state compact">
        <LoaderCircle className="spin" />
        <h2>{snapshotState.error || "Loading"}</h2>
      </div>
    );

  if (!continuous.configured)
    return (
      <section className="automation-unavailable">
        <ShieldCheck />
        <div>
          <h2>Not available</h2>
        </div>
      </section>
    );

  return (
    <div className="automation-page">
      <section className="automation-stats" aria-label="Arbitrage summary">
        <div>
          <span>Total PnL</span>
          <strong
            className={totalPnl.some((item) => item.raw > 0n) ? "positive" : ""}
          >
            {totalPnlLabel}
          </strong>
        </div>
        <div>
          <span>Watching</span>
          <strong>{activeStrategies.length}</strong>
        </div>
        <div>
          <span>Runs</span>
          <strong>{continuous.executions.length}</strong>
        </div>
      </section>

      <section className="automation-list-section">
        <div className="section-heading portfolio-arb-heading">
          <h2>Active</h2>
          <span>
            {activeStrategies.length} watching · {continuous.executions.length}{" "}
            runs
          </span>
        </div>
        {activeStrategies.length ? (
          <div className="automation-list">
            <div className="automation-table-head" aria-hidden="true">
              <span>Market</span>
              <span>Each run</span>
              <span>Left</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {activeStrategies.map((strategy) => {
              const market = marketFor(markets, strategy.hToken);
              const decimals = market?.reserveDecimals ?? 18;
              const symbol = market?.reserveSymbol ?? "Reserve";
              return (
                <article key={strategy.id}>
                  <div className="automation-market">
                    <Image
                      src={tokenLogoUrl(strategy.hToken, CHAINS.base.id)}
                      alt=""
                      width={34}
                      height={34}
                      unoptimized
                    />
                    <span>
                      <strong>
                        {market
                          ? `${market.reserveSymbol} ↔ ${market.symbol}`
                          : shortAddress(strategy.hToken)}
                      </strong>
                      <small>#{strategy.id}</small>
                    </span>
                  </div>
                  <strong>
                    {tokenAmount(strategy.maxReservePerExecutionRaw, decimals)}{" "}
                    {symbol}
                  </strong>
                  <strong>
                    {tokenAmount(strategy.remainingVolumeRaw, decimals)}{" "}
                    {symbol}
                  </strong>
                  <span className="automation-live">
                    Watching · {strategy.executionCount}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void stopContinuous(strategy.id, strategy.reserveToken)
                    }
                    type="button"
                  >
                    <Pause /> Stop
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact">
            <ShieldCheck />
            <h2>No arbitrage</h2>
          </div>
        )}
      </section>

      {message && (
        <div className="automation-message">
          <CheckCircle2 />
          <span>{message}</span>
        </div>
      )}
      {error && (
        <div className="alert danger">
          <ShieldCheck />
          <div>
            <strong>Failed</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <section className="automation-list-section">
        <div className="section-heading portfolio-arb-heading">
          <h2>History</h2>
        </div>
        {continuous.executions.length ? (
          <div className="automation-history">
            <div className="automation-table-head" aria-hidden="true">
              <span>Market</span>
              <span>PnL</span>
              <span>Used</span>
              <span>Block</span>
              <span>Action</span>
            </div>
            {continuous.executions.map((execution) => {
              const strategy = continuous.strategies.find(
                (item) => item.id === execution.strategyId,
              );
              const market = strategy
                ? marketFor(markets, strategy.hToken)
                : undefined;
              const decimals = market?.reserveDecimals ?? 18;
              const symbol = market?.reserveSymbol ?? "Reserve";
              return (
                <a
                  href={`${CHAINS.base.explorerUrl}/tx/${execution.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                  key={`${execution.transactionHash}-${execution.strategyId}`}
                >
                  <div className="automation-market">
                    <Image
                      src={tokenLogoUrl(
                        strategy?.hToken ?? execution.reserveToken,
                        CHAINS.base.id,
                      )}
                      alt=""
                      width={34}
                      height={34}
                      unoptimized
                    />
                    <span>
                      <strong>
                        {market
                          ? `${market.reserveSymbol} ↔ ${market.symbol}`
                          : shortAddress(execution.reserveToken)}
                      </strong>
                      <small>{execution.direction}</small>
                    </span>
                  </div>
                  <strong className="positive">
                    +{tokenAmount(execution.ownerProfitReserveRaw, decimals)}{" "}
                    {symbol}
                  </strong>
                  <span>
                    {tokenAmount(execution.amountInReserveRaw, decimals)}{" "}
                    {symbol}
                  </span>
                  <b>{execution.blockNumber}</b>
                  <ExternalLink />
                </a>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact">
            <ShieldCheck />
            <h2>No history</h2>
          </div>
        )}
      </section>
    </div>
  );
}
