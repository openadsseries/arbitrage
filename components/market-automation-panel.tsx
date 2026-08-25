"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, Pause, Play, ShieldCheck } from "lucide-react";
import { encodeFunctionData, formatUnits, type Address } from "viem";
import { useWallet } from "@/components/wallet-provider";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ERC20_PERMISSION_ABI,
  getArbitrageMinimumProfit,
  type ArbitrageMarketReadiness,
  type ContinuousArbitrageSnapshot,
  type ReserveArbitrageExecution,
} from "@/lib/arbitrage";
import { shortAddress } from "@/lib/format";
import type { VerifiedMarket } from "@/lib/onchain-types";
import { sendAtomicCallsIfSupported } from "@/lib/wallet-calls";

type Preparation = {
  chain: "base";
  executor: Address;
  hToken: Address;
  hSymbol: string;
  reserveToken: Address;
  reserveSymbol: string;
  readBlock: string;
};

function reserveAmount(raw: string, decimals: number) {
  return Number(formatUnits(BigInt(raw), decimals)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function errorMessage(reason: unknown, fallback: string) {
  const simplify = (message: string) => {
    if (/user denied|user rejected|request signature/i.test(message)) return "Wallet approval was cancelled.";
    if (/http request failed|failed to fetch|network request/i.test(message)) return "The Base read was interrupted. Try again.";
    return message;
  };
  if (reason instanceof Error) return simplify(reason.message);
  if (typeof reason === "object" && reason) {
    const value = reason as { message?: unknown; shortMessage?: unknown; details?: unknown };
    for (const candidate of [value.shortMessage, value.message, value.details]) {
      if (typeof candidate === "string" && candidate.trim()) return simplify(candidate);
    }
  }
  return fallback;
}

export function MarketAutomationPanel({
  market,
  initialReadiness,
  onExecutionChange,
  budget,
  budgetRaw,
  onBudgetChange,
  estimatedProfitRaw,
}: {
  market: VerifiedMarket;
  initialReadiness: ArbitrageMarketReadiness | null;
  onExecutionChange?: (execution: ReserveArbitrageExecution | null) => void;
  budget: string;
  budgetRaw: bigint | null;
  onBudgetChange: (value: string) => void;
  estimatedProfitRaw: string | null;
}) {
  const wallet = useWallet();
  const [snapshot, setSnapshot] = useState<ContinuousArbitrageSnapshot | null>(null);
  const [snapshotOwner, setSnapshotOwner] = useState<Address | null>(null);
  const [readiness, setReadiness] = useState<ArbitrageMarketReadiness | null>(initialReadiness);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [reserveBalanceRaw, setReserveBalanceRaw] = useState<bigint | null>(null);
  const [reserveAllowanceRaw, setReserveAllowanceRaw] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showRevoke, setShowRevoke] = useState(false);
  const [totalLimit, setTotalLimit] = useState("");
  const [totalLimitEdited, setTotalLimitEdited] = useState(false);
  const [hasEndTime, setHasEndTime] = useState(false);
  const [endHours, setEndHours] = useState("24");

  const readSnapshot = useCallback(async (address: Address) => {
    const response = await fetch(`/api/arbitrage/v3?wallet=${address}`, { cache: "no-store" });
    const payload = await response.json() as { snapshot?: ContinuousArbitrageSnapshot; error?: string };
    if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "Could not read arbitrage.");
    return payload.snapshot;
  }, []);

  useEffect(() => {
    if (market.chain !== "base" || initialReadiness) return;
    const controller = new AbortController();
    fetch(`/api/arbitrage/readiness?chain=base&token=${market.token}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { readiness?: ArbitrageMarketReadiness; error?: string };
        if (!response.ok || !payload.readiness) throw new Error(payload.error ?? "Could not read arbitrage readiness.");
        setReadiness(payload.readiness);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(errorMessage(reason, "Could not read arbitrage readiness."));
      });
    return () => controller.abort();
  }, [initialReadiness, market.chain, market.token]);

  useEffect(() => {
    if (market.chain !== "base" || !readiness?.ready) return;
    const controller = new AbortController();
    fetch(`/api/arbitrage/prepare?chain=base&token=${market.token}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { preparation?: Preparation; error?: string };
        if (!response.ok || !payload.preparation) throw new Error(payload.error ?? "This market is not ready for arbitrage.");
        setPreparation(payload.preparation);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(errorMessage(reason, "This market is not ready for arbitrage."));
      });
    return () => controller.abort();
  }, [market.chain, market.token, readiness?.ready]);

  const refreshWalletState = useCallback(async (address: Address, nextPreparation: Preparation | null) => {
    const nextSnapshot = await readSnapshot(address);
    setSnapshot(nextSnapshot);
    setSnapshotOwner(address);
    if (nextPreparation && nextSnapshot.executor) {
      const client = await wallet.getPublicClient("base");
      const [balance, allowance] = await Promise.all([
        client.readContract({
          address: nextPreparation.reserveToken,
          abi: ERC20_PERMISSION_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
        client.readContract({
          address: nextPreparation.reserveToken,
          abi: ERC20_PERMISSION_ABI,
          functionName: "allowance",
          args: [address, nextSnapshot.executor],
        }),
      ]);
      setReserveBalanceRaw(balance);
      setReserveAllowanceRaw(allowance);
    } else {
      setReserveAllowanceRaw(0n);
    }
  }, [readSnapshot, wallet]);

  useEffect(() => {
    if (!wallet.address) return;
    const address = wallet.address;
    const timeout = window.setTimeout(() => {
      refreshWalletState(address, preparation).catch((reason) => {
        setError(errorMessage(reason, "Could not read arbitrage."));
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [preparation, refreshWalletState, wallet.address]);

  const activeSnapshot = wallet.address && snapshotOwner?.toLowerCase() === wallet.address.toLowerCase() ? snapshot : null;
  const running = useMemo(() => activeSnapshot?.strategies.find((strategy) =>
    strategy.hToken.toLowerCase() === market.token.toLowerCase()
      && strategy.active
      && BigInt(strategy.remainingVolumeRaw) > 0n
      && (strategy.validUntil === 0 || strategy.validUntil > (activeSnapshot?.readTimestamp ?? 0))
  ) ?? null, [activeSnapshot, market.token]);
  const latestExecution = useMemo(() => {
    if (!activeSnapshot) return null;
    const strategyIds = new Set(activeSnapshot.strategies
      .filter((strategy) => strategy.hToken.toLowerCase() === market.token.toLowerCase())
      .map((strategy) => strategy.id));
    return activeSnapshot.executions.find((execution) => strategyIds.has(execution.strategyId)) ?? null;
  }, [activeSnapshot, market.token]);
  const displayedTotalLimit = totalLimitEdited
    ? totalLimit
    : budgetRaw === null
      ? ""
      : formatUnits(budgetRaw * 10n, market.reserveDecimals);
  const totalLimitRaw = useMemo(() => {
    try {
      if (!displayedTotalLimit.trim() || Number(displayedTotalLimit) <= 0) return null;
      const [whole = "", fraction = ""] = displayedTotalLimit.trim().split(".");
      if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > market.reserveDecimals) return null;
      return BigInt(`${whole}${fraction.padEnd(market.reserveDecimals, "0")}`);
    } catch {
      return null;
    }
  }, [displayedTotalLimit, market.reserveDecimals]);
  const endHoursNumber = Number(endHours);
  const budgetError = budgetRaw === null
    ? "Enter a valid budget."
    : reserveBalanceRaw !== null && budgetRaw > reserveBalanceRaw
      ? `Not enough ${market.reserveSymbol} in this wallet.`
      : "";
  const totalLimitError = totalLimitRaw === null
    ? "Enter a valid total limit."
    : budgetRaw !== null && totalLimitRaw < budgetRaw
      ? "Total limit must cover at least one trade."
      : "";
  const endTimeError = hasEndTime && (!Number.isFinite(endHoursNumber) || endHoursNumber <= 0)
    ? "Enter a valid duration."
    : "";
  const minimumProfitRaw = getArbitrageMinimumProfit(budgetRaw ?? 0n);
  const permissionRemaining = !running && reserveAllowanceRaw > 0n;
  const runningExecutions = useMemo(() => activeSnapshot?.executions.filter(
    (execution) => execution.strategyId === running?.id,
  ) ?? [], [activeSnapshot, running?.id]);
  const totalProfitRaw = runningExecutions.reduce(
    (total, execution) => total + BigInt(execution.ownerProfitReserveRaw),
    0n,
  );

  useEffect(() => { onExecutionChange?.(latestExecution); }, [latestExecution, onExecutionChange]);

  useEffect(() => {
    if (!wallet.address || !running) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshWalletState(wallet.address!, preparation);
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [preparation, refreshWalletState, running, wallet.address]);

  async function start() {
    if (!preparation || budgetRaw === null || totalLimitRaw === null || budgetError || totalLimitError || endTimeError) return;
    setBusy(true);
    setProgress("Connecting wallet");
    setError("");
    setMessage("");
    let approvalMayRemain = false;
    try {
      const address = wallet.address ?? await wallet.connect("base");
      if (!address) throw new Error("Connect a wallet to start arbitrage.");
      const currentSnapshot = wallet.address && activeSnapshot ? activeSnapshot : await readSnapshot(address);
      if (!currentSnapshot.configured || !currentSnapshot.executor) throw new Error("Continuous arbitrage is not available yet.");

      const publicClient = await wallet.getPublicClient("base");
      const walletClient = await wallet.getWalletClient("base");
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({ address: preparation.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "balanceOf", args: [address] }),
        publicClient.readContract({ address: preparation.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "allowance", args: [address, currentSnapshot.executor] }),
      ]);
      if (balance < budgetRaw) throw new Error(`Not enough ${market.reserveSymbol} in this wallet.`);
      const validUntil = hasEndTime
        ? Math.floor(Date.now() / 1_000) + Math.floor(endHoursNumber * 60 * 60)
        : 0;
      const startCall = {
        to: currentSnapshot.executor,
        data: encodeFunctionData({
          abi: ARBITRAGE_EXECUTOR_V3_ABI,
          functionName: "startStrategy",
          args: [market.token, budgetRaw, totalLimitRaw, minimumProfitRaw, validUntil],
        }),
      } as const;
      const approvalCalls = allowance === totalLimitRaw ? [] : [
        ...(allowance > 0n ? [{
          to: preparation.reserveToken,
          data: encodeFunctionData({ abi: ERC20_PERMISSION_ABI, functionName: "approve", args: [currentSnapshot.executor, 0n] }),
        }] : []),
        {
          to: preparation.reserveToken,
          data: encodeFunctionData({ abi: ERC20_PERMISSION_ABI, functionName: "approve", args: [currentSnapshot.executor, totalLimitRaw] }),
        },
      ];

      let atomicStarted = false;
      if (approvalCalls.length > 0) {
        setProgress("Confirm in your wallet");
        atomicStarted = await sendAtomicCallsIfSupported({
          getCapabilities: () => walletClient.getCapabilities({ account: address, chainId: 8453 }),
          sendCalls: () => walletClient.sendCalls({ account: address, calls: [...approvalCalls, startCall], forceAtomic: true }),
          waitForCallsStatus: (id) => walletClient.waitForCallsStatus({ id, throwOnFailure: true, timeout: 120_000 }),
        });
      }

      if (!atomicStarted) {
        for (const [index, call] of approvalCalls.entries()) {
          setProgress(index === approvalCalls.length - 1 ? `Approving ${market.reserveSymbol}` : "Resetting approval");
          const hash = await walletClient.sendTransaction({ account: address, chain: undefined, to: call.to, data: call.data });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error(`${market.reserveSymbol} approval did not confirm.`);
          if (index === approvalCalls.length - 1) approvalMayRemain = true;
        }
        setProgress("Starting arbitrage");
        const request = await publicClient.simulateContract({
          account: address,
          address: currentSnapshot.executor,
          abi: ARBITRAGE_EXECUTOR_V3_ABI,
          functionName: "startStrategy",
          args: [market.token, budgetRaw, totalLimitRaw, minimumProfitRaw, validUntil],
        });
        const hash = await walletClient.writeContract(request.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Arbitrage did not start.");
      }
      setShowRevoke(false);
      setMessage("Continuous arbitrage started.");
      await refreshWalletState(address, preparation);
    } catch (reason) {
      if (approvalMayRemain) setShowRevoke(true);
      setError(errorMessage(reason, "Could not start arbitrage."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function stopAndRevoke() {
    if (!wallet.address || !activeSnapshot?.executor || !running || !preparation) return;
    setBusy(true);
    setProgress("Stopping arbitrage");
    setError("");
    try {
      const publicClient = await wallet.getPublicClient("base");
      const walletClient = await wallet.getWalletClient("base");
      const stopCall = {
        to: activeSnapshot.executor,
        data: encodeFunctionData({
          abi: ARBITRAGE_EXECUTOR_V3_ABI,
          functionName: "stopStrategy",
          args: [BigInt(running.id)],
        }),
      } as const;
      const revokeCall = {
        to: preparation.reserveToken,
        data: encodeFunctionData({
          abi: ERC20_PERMISSION_ABI,
          functionName: "approve",
          args: [activeSnapshot.executor, 0n],
        }),
      } as const;
      const calls = reserveAllowanceRaw > 0n ? [stopCall, revokeCall] : [stopCall];
      const atomicStopped = await sendAtomicCallsIfSupported({
        getCapabilities: () => walletClient.getCapabilities({ account: wallet.address!, chainId: 8453 }),
        sendCalls: () => walletClient.sendCalls({ account: wallet.address!, calls, forceAtomic: true }),
        waitForCallsStatus: (id) => walletClient.waitForCallsStatus({ id, throwOnFailure: true, timeout: 120_000 }),
      });
      if (!atomicStopped) {
        for (const [index, call] of calls.entries()) {
          setProgress(index === 0 ? "Stopping arbitrage" : "Removing permission");
          const hash = await walletClient.sendTransaction({
            account: wallet.address,
            chain: undefined,
            to: call.to,
            data: call.data,
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            if (index === 0) throw new Error("Arbitrage did not stop.");
            throw new Error("Arbitrage stopped, but the remaining permission was not removed.");
          }
        }
      }
      setShowRevoke(false);
      setReserveAllowanceRaw(0n);
      setMessage("Arbitrage stopped and permission removed.");
      await refreshWalletState(wallet.address, preparation);
    } catch (reason) {
      setShowRevoke(true);
      setError(errorMessage(reason, "Could not stop arbitrage and remove permission."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function revoke() {
    if (!wallet.address || !activeSnapshot?.executor || !preparation) return;
    setBusy(true);
    setError("");
    try {
      const publicClient = await wallet.getPublicClient("base");
      const walletClient = await wallet.getWalletClient("base");
      const request = await publicClient.simulateContract({ account: wallet.address, address: preparation.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "approve", args: [activeSnapshot.executor, 0n] });
      const hash = await walletClient.writeContract(request.request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The wallet limit was not removed.");
      setShowRevoke(false);
      setReserveAllowanceRaw(0n);
      setMessage(`${market.reserveSymbol} permission removed.`);
    } catch (reason) {
      setError(errorMessage(reason, "Could not remove the wallet limit."));
    } finally {
      setBusy(false);
    }
  }

  if (market.chain !== "base") return <ArbitrageNotice title="Not available on this network" body="Arbitrage is available on Base first." />;
  if (!readiness) return <ArbitrageNotice title="Arbitrage status unavailable" body="Refresh to check both markets again." />;
  if (!readiness.originalMarket.ready) return <ArbitrageNotice title={`${market.reserveSymbol} cannot be compared yet`} body={`A live ${market.reserveSymbol} market is required.`} />;
  if (!readiness.hypedMarket.ready) return <ArbitrageNotice title={`${market.symbol} needs a pool`} body="Create its independent market before checking arbitrage." action={{ href: `/launch/market?token=${market.token}`, label: `Create ${market.symbol} pool` }} />;
  if (!readiness.executorReady) return <ArbitrageNotice title="Arbitrage temporarily unavailable" body="The Reserve Token execution update has not been deployed yet." />;
  if (wallet.address && !activeSnapshot) return <ArbitrageNotice icon="loading" title="Reading arbitrage" body="Only confirmed Base state is shown." />;
  if (activeSnapshot && !activeSnapshot.configured) return <ArbitrageNotice title="Arbitrage contract not recorded" body="The Reserve Token executor is not configured in this deployment." />;

  return <section className="market-auto-panel">
    {running ? <>
      <div className="market-auto-status"><span><i /> Running</span><small>{running.validUntil === 0 ? "Until you stop" : `Ends ${new Date(running.validUntil * 1_000).toLocaleString("en-US")}`}</small></div>
      <h2>Continuous arbitrage is on.</h2>
      <dl className="market-auto-summary">
        <div><dt>Total profit</dt><dd className="positive">+{reserveAmount(totalProfitRaw.toString(), market.reserveDecimals)} {market.reserveSymbol}</dd></div>
        <div><dt>Executions</dt><dd>{running.executionCount}</dd></div>
        <div><dt>Remaining limit</dt><dd>{reserveAmount(running.remainingVolumeRaw, market.reserveDecimals)} {market.reserveSymbol}</dd></div>
        <div><dt>Budget per trade</dt><dd>{reserveAmount(running.maxReservePerExecutionRaw, market.reserveDecimals)} {market.reserveSymbol}</dd></div>
      </dl>
      <button className="market-auto-stop" disabled={busy} onClick={() => void stopAndRevoke()} type="button">{busy ? <LoaderCircle className="spin" /> : <Pause />} {busy ? progress : "Stop and remove permission"}</button>
    </> : <>
      <span className="kicker">2 · Start continuous arbitrage</span>
      <div className="market-auto-budget">
        <label htmlFor="arbitrage-budget">Budget per trade</label>
        <div className="market-auto-budget-input">
          <input id="arbitrage-budget" inputMode="decimal" min="0" onChange={(event) => onBudgetChange(event.target.value)} placeholder="1" step="any" type="number" value={budget} />
          <span>{market.reserveSymbol}</span>
        </div>
        <label htmlFor="arbitrage-total-limit">Total limit</label>
        <div className="market-auto-budget-input">
          <input
            id="arbitrage-total-limit"
            inputMode="decimal"
            min="0"
            onChange={(event) => {
              setTotalLimitEdited(true);
              setTotalLimit(event.target.value);
            }}
            placeholder="1000"
            step="any"
            type="number"
            value={displayedTotalLimit}
          />
          <span>{market.reserveSymbol}</span>
        </div>
        <dl className="market-auto-budget-meta">
          <div>
            <dt>Available</dt>
            <dd>{wallet.address && reserveBalanceRaw !== null ? `${reserveAmount(reserveBalanceRaw.toString(), market.reserveDecimals)} ${market.reserveSymbol}` : "Connect wallet"}</dd>
          </div>
          <div>
            <dt>Estimated profit</dt>
            <dd className={estimatedProfitRaw ? "positive" : ""}>{estimatedProfitRaw ? `+${reserveAmount(estimatedProfitRaw, market.reserveDecimals)} ${market.reserveSymbol}` : "—"}</dd>
          </div>
        </dl>
        {budgetError && <em>{budgetError}</em>}
        {!budgetError && totalLimitError && <em>{totalLimitError}</em>}
        {!budgetError && !totalLimitError && endTimeError && <em>{endTimeError}</em>}
      </div>
      <button className="button-primary automation-action" disabled={busy || !preparation || Boolean(budgetError || totalLimitError || endTimeError)} onClick={() => void start()} type="button">
        {busy ? <LoaderCircle className="spin" /> : <Play />} {busy ? progress : preparation ? "Start continuous arbitrage" : "Preparing"}
      </button>
      <p className="market-auto-policy">Checks both routes repeatedly. Funds stay in your wallet between executions.</p>
    </>}

    {message && <div className="market-auto-message"><CheckCircle2 /> {message}</div>}
    {error && <div className="market-auto-error"><ShieldCheck /> {error}</div>}
    {(showRevoke || permissionRemaining) && !running && <button className="market-auto-revoke" disabled={busy} onClick={() => void revoke()} type="button">Remove remaining permission</button>}
    <details className="market-auto-details">
      <summary>Details</summary>
      {!running && <label className="market-auto-end-time">
        <span><input checked={hasEndTime} onChange={(event) => setHasEndTime(event.target.checked)} type="checkbox" /> Set an end time</span>
        {hasEndTime && <span className="market-auto-end-input"><input inputMode="decimal" min="1" onChange={(event) => setEndHours(event.target.value)} step="1" type="number" value={endHours} /> hours</span>}
      </label>}
      <p>Each execution must return the principal and protected profit in {market.reserveSymbol}. The total limit bounds cumulative use.</p>
      <dl>
        <div><dt>GETHYPED fee</dt><dd>{(activeSnapshot?.protocolFeeBps ?? 0) / 100}%</dd></div>
        <div><dt>Successful executor</dt><dd>{(activeSnapshot?.executorRewardBps ?? 2_000) / 100}% of profit</dd></div>
        {activeSnapshot?.executor && <div><dt>Executor</dt><dd>{shortAddress(activeSnapshot.executor)}</dd></div>}
      </dl>
    </details>
  </section>;
}

function ArbitrageNotice({ title, body, icon, action }: { title: string; body: string; icon?: "loading"; action?: { href: string; label: string } }) {
  return <section className="market-auto-panel market-auto-notice">{icon === "loading" ? <LoaderCircle className="spin" /> : <ShieldCheck />}<div><h2>{title}</h2><p>{body}</p>{action && <Link className="button-primary automation-action" href={action.href}>{action.label}</Link>}</div></section>;
}
