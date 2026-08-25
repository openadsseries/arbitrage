"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Info, LoaderCircle, Pause, Play, ShieldCheck, X } from "lucide-react";
import { encodeFunctionData, formatUnits, type Address } from "viem";
import { useWallet } from "@/components/wallet-provider";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ERC20_PERMISSION_ABI,
  getArbitrageMinimumProfit,
  type ArbitrageMarketReadiness,
  type ContinuousArbitrageSnapshot,
  type DirectArbitrageExecutionQuote,
  type ReserveArbitrageExecution,
} from "@/lib/arbitrage";
import { compactActionError as errorMessage } from "@/lib/errors";
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
type RelayPayload = {
  status?: "executed" | "ready" | "waiting-gas" | "none";
  hash?: `0x${string}`;
  execution?: DirectArbitrageExecutionQuote | null;
  error?: string;
};

class RelayRequestError extends Error {
  payload: RelayPayload;

  constructor(message: string, payload: RelayPayload) {
    super(message);
    this.name = "RelayRequestError";
    this.payload = payload;
  }
}

const AUTO_REPEAT_COUNT = 10n;
const WATCH_VISIBLE_MS = 30_000;
const WATCH_HIDDEN_MS = 120_000;
const RELAY_COOLDOWN_MS = 12_000;
const PASSIVE_WATCH_REASONS = new Set([
  "Base is busy. Try again soon.",
  "Not executable now.",
  "No route now.",
  "Waiting for gas.",
]);

function reserveAmount(raw: string, decimals: number) {
  return Number(formatUnits(BigInt(raw), decimals)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hasLiveMarketStrategy(snapshot: ContinuousArbitrageSnapshot, token: Address) {
  return snapshot.strategies.some((strategy) =>
    strategy.hToken.toLowerCase() === token.toLowerCase()
      && strategy.active
      && BigInt(strategy.remainingVolumeRaw) > 0n
      && (strategy.validUntil === 0 || strategy.validUntil > snapshot.readTimestamp)
  );
}

export function MarketAutomationPanel({
  market,
  initialReadiness,
  onExecutionChange,
  onPositionChange,
  onActiveAmountChange,
  onActiveQuoteChange,
  onWatchReasonChange,
  budget,
  budgetRaw,
  onBudgetChange,
  estimatedProfitRaw,
}: {
  market: VerifiedMarket;
  initialReadiness: ArbitrageMarketReadiness | null;
  onExecutionChange?: (execution: ReserveArbitrageExecution | null) => void;
  onPositionChange?: () => void;
  onActiveAmountChange?: (raw: string | null) => void;
  onActiveQuoteChange?: (quote: DirectArbitrageExecutionQuote | null) => void;
  onWatchReasonChange?: (reason: string) => void;
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
  const [watchReason, setWatchReason] = useState("");
  const [showRevoke, setShowRevoke] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const relayInFlight = useRef(false);
  const relayCooldownUntil = useRef(0);

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
    return nextSnapshot;
  }, [readSnapshot, wallet]);

  const refreshSettledWalletState = useCallback(async (address: Address, nextPreparation: Preparation | null) => {
    let latest = await refreshWalletState(address, nextPreparation);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await wait(900);
      latest = await refreshWalletState(address, nextPreparation);
    }
    return latest;
  }, [refreshWalletState]);

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
  const budgetError = budgetRaw === null
    ? "Enter a valid amount."
    : reserveBalanceRaw !== null && budgetRaw > reserveBalanceRaw
      ? `Not enough ${market.reserveSymbol} in this wallet.`
      : "";
  const minimumProfitRaw = getArbitrageMinimumProfit(budgetRaw ?? 0n);
  const permissionRemaining = !running && reserveAllowanceRaw > 0n;
  const runningExecutions = useMemo(() => activeSnapshot?.executions.filter(
    (execution) => execution.strategyId === running?.id,
  ) ?? [], [activeSnapshot, running?.id]);
  const totalProfitRaw = runningExecutions.reduce(
    (total, execution) => total + BigInt(execution.ownerProfitReserveRaw) + (
      wallet.address && execution.executor.toLowerCase() === wallet.address.toLowerCase()
        ? BigInt(execution.executorRewardReserveRaw)
        : 0n
    ),
    0n,
  );

  useEffect(() => { onExecutionChange?.(latestExecution); }, [latestExecution, onExecutionChange]);
  useEffect(() => { onActiveAmountChange?.(running?.maxReservePerExecutionRaw ?? null); }, [onActiveAmountChange, running?.maxReservePerExecutionRaw]);
  useEffect(() => { onWatchReasonChange?.(watchReason); }, [onWatchReasonChange, watchReason]);

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

  const relayStrategy = useCallback(async (address: Address, strategyId: string) => {
    const response = await fetch("/api/arbitrage/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: address, strategyId }),
    });
    const payload = await response.json() as RelayPayload;
    if (!response.ok || !payload.hash) throw new RelayRequestError(payload.error ?? "Watching.", payload);
    return payload;
  }, []);

  useEffect(() => {
    if (!wallet.address || !activeSnapshot?.executor || !running) return;
    let active = true;
    let timeout: number | undefined;
    const run = async () => {
      if (!active) return;
      if (relayInFlight.current || Date.now() < relayCooldownUntil.current) {
        schedule();
        return;
      }
      relayInFlight.current = true;
      try {
        const payload = await relayStrategy(wallet.address!, running.id);
        onActiveQuoteChange?.(payload.execution ?? null);
        relayCooldownUntil.current = Date.now() + RELAY_COOLDOWN_MS;
        if (!active) return;
        setWatchReason("");
        setMessage("Executed. Still watching.");
        await refreshSettledWalletState(wallet.address!, preparation);
        onPositionChange?.();
      } catch (reason) {
        if (active) {
          const text = errorMessage(reason, "Watching.");
          onActiveQuoteChange?.(reason instanceof RelayRequestError ? reason.payload.execution ?? null : null);
          setWatchReason(text);
          if (PASSIVE_WATCH_REASONS.has(text)) setError("");
        }
      } finally {
        relayInFlight.current = false;
        schedule();
      }
    };
    const schedule = () => {
      if (!active) return;
      const delay = document.visibilityState === "visible" ? WATCH_VISIBLE_MS : WATCH_HIDDEN_MS;
      timeout = window.setTimeout(() => void run(), delay);
    };
    void run();
    return () => {
      active = false;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [activeSnapshot?.executor, onActiveQuoteChange, onPositionChange, preparation, refreshSettledWalletState, relayStrategy, running, wallet.address]);

  async function execute() {
    if (!preparation || budgetRaw === null || budgetError) return;
    setBusy(true);
    setProgress("Connecting wallet");
    setError("");
    setMessage("");
    setWatchReason("");
    let approvalMayRemain = false;
    try {
      const address = wallet.address ?? await wallet.connect("base");
      if (!address) throw new Error("Connect a wallet to execute.");
      const currentSnapshot = wallet.address && activeSnapshot ? activeSnapshot : await readSnapshot(address);
      if (!currentSnapshot.configured || !currentSnapshot.executor) throw new Error("Arbitrage is not available yet.");

      const publicClient = await wallet.getPublicClient("base");
      const walletClient = await wallet.getWalletClient("base");
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({ address: preparation.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "balanceOf", args: [address] }),
        publicClient.readContract({ address: preparation.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "allowance", args: [address, currentSnapshot.executor] }),
      ]);
      if (balance < budgetRaw) throw new Error(`Not enough ${market.reserveSymbol} in this wallet.`);
      const totalLimitRaw = balance < budgetRaw * AUTO_REPEAT_COUNT ? balance : budgetRaw * AUTO_REPEAT_COUNT;
      const validUntil = 0;
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
        setProgress("Prepare");
        const request = await publicClient.simulateContract({
          account: address,
          address: currentSnapshot.executor,
          abi: ARBITRAGE_EXECUTOR_V3_ABI,
          functionName: "startStrategy",
          args: [market.token, budgetRaw, totalLimitRaw, minimumProfitRaw, validUntil],
        });
        const hash = await walletClient.writeContract(request.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Preparation failed.");
      }
      setShowRevoke(false);
      const strategyId = await publicClient.readContract({
        address: currentSnapshot.executor,
        abi: ARBITRAGE_EXECUTOR_V3_ABI,
        functionName: "activeStrategyId",
        args: [address, preparation.reserveToken],
        blockTag: "pending",
      });
      if (strategyId === 0n) throw new Error("Position not found.");
      let executed = false;
      try {
        setProgress("Execute");
        const payload = await relayStrategy(address, strategyId.toString());
        onActiveQuoteChange?.(payload.execution ?? null);
        relayCooldownUntil.current = Date.now() + RELAY_COOLDOWN_MS;
        executed = true;
      } catch (reason) {
        const text = errorMessage(reason, "Watching.");
        onActiveQuoteChange?.(reason instanceof RelayRequestError ? reason.payload.execution ?? null : null);
        setWatchReason(text);
        if (!PASSIVE_WATCH_REASONS.has(text)) setError(text);
      }
      const nextSnapshot = await refreshSettledWalletState(address, preparation);
      setMessage(executed
        ? hasLiveMarketStrategy(nextSnapshot, market.token) ? "Executed. Still watching." : "Executed."
        : "Watching.");
      onPositionChange?.();
    } catch (reason) {
      if (approvalMayRemain) setShowRevoke(true);
      setError(errorMessage(reason, "Could not execute."));
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
    setWatchReason("");
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
      onPositionChange?.();
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
      onPositionChange?.();
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
      <div className="market-auto-status"><span><i /> Watching</span><small>{watchReason || "This browser"}</small></div>
      <h2>{watchReason === "Waiting for gas." ? "Waiting for gas to drop." : "Watching prices."}</h2>
      <dl className="market-auto-summary">
        <div><dt>Profit</dt><dd className="positive">+{reserveAmount(totalProfitRaw.toString(), market.reserveDecimals)} {market.reserveSymbol}</dd></div>
        <div><dt>Runs</dt><dd>{running.executionCount}</dd></div>
        <div><dt>Left</dt><dd>{reserveAmount(running.remainingVolumeRaw, market.reserveDecimals)} {market.reserveSymbol}</dd></div>
      </dl>
      <div className="market-auto-actions">
        <button className="market-auto-stop" disabled={busy} onClick={() => void stopAndRevoke()} type="button">{busy ? <LoaderCircle className="spin" /> : <Pause />} Stop</button>
      </div>
    </> : <>
      <span className="kicker">2 · Execute</span>
      <div className="market-auto-budget">
        <label htmlFor="arbitrage-budget">Amount each time</label>
        <div className="market-auto-budget-input">
          <input id="arbitrage-budget" inputMode="decimal" min="0" onChange={(event) => onBudgetChange(event.target.value)} placeholder="1" step="any" type="number" value={budget} />
          <span>{market.reserveSymbol}</span>
        </div>
        <dl className="market-auto-budget-meta">
          <div>
            <dt>Available</dt>
            <dd>{wallet.address && reserveBalanceRaw !== null ? `${reserveAmount(reserveBalanceRaw.toString(), market.reserveDecimals)} ${market.reserveSymbol}` : "Connect wallet"}</dd>
          </div>
          <div>
            <dt>Est. profit</dt>
            <dd className={estimatedProfitRaw ? "positive" : ""}>{estimatedProfitRaw ? `+${reserveAmount(estimatedProfitRaw, market.reserveDecimals)} ${market.reserveSymbol}` : "—"}</dd>
          </div>
        </dl>
        {budgetError && <em>{budgetError}</em>}
      </div>
      <button className="button-primary automation-action" disabled={busy || !preparation || Boolean(budgetError)} onClick={() => void execute()} type="button">
        {busy ? <LoaderCircle className="spin" /> : <Play />} {busy ? progress : preparation ? "Execute arbitrage" : "Preparing"}
      </button>
    </>}

    {message && <div className="market-auto-message"><CheckCircle2 /> {message}</div>}
    {error && <div className="market-auto-error"><ShieldCheck /> {error}</div>}
    {(showRevoke || permissionRemaining) && !running && <button className="market-auto-revoke" disabled={busy} onClick={() => void revoke()} type="button">Remove permission</button>}
    <button className="market-details-trigger" onClick={() => setDetailsOpen(true)} type="button"><Info /> Details</button>
    {detailsOpen && <div className="market-details-layer" role="presentation" onMouseDown={() => setDetailsOpen(false)}>
      <section className="market-details-dialog" aria-label="Arbitrage details" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="market-details-close" aria-label="Close details" onClick={() => setDetailsOpen(false)} type="button"><X /></button>
        <span className="kicker">Details</span>
        <h2>Checks</h2>
        <div className="market-details-grid">
          <div><strong>Chart</strong><p>Daily USD prices.</p></div>
          <div><strong>Profit</strong><p>Live route after fees.</p></div>
          <div><strong>{market.symbol} high</strong><p>Mint, then sell.</p></div>
          <div><strong>{market.symbol} low</strong><p>Buy, then redeem.</p></div>
          <div><strong>Permission</strong><p>Covers repeats. Capped by balance.</p></div>
          <div><strong>Execution</strong><p>Click once. Then it watches.</p></div>
          <div><strong>Gas</strong><p>Checked before each run.</p></div>
          <div><strong>Stop</strong><p>Stops and removes permission.</p></div>
        </div>
        <dl>
          <div><dt>GETHYPED fee</dt><dd>{(activeSnapshot?.protocolFeeBps ?? 0) / 100}%</dd></div>
          <div><dt>Executor</dt><dd>{(activeSnapshot?.executorRewardBps ?? 2_000) / 100}% of profit</dd></div>
          <div><dt>User share</dt><dd>{100 - (activeSnapshot?.protocolFeeBps ?? 0) / 100 - (activeSnapshot?.executorRewardBps ?? 2_000) / 100}% of profit</dd></div>
          {activeSnapshot?.executor && <div><dt>Executor</dt><dd>{shortAddress(activeSnapshot.executor)}</dd></div>}
        </dl>
      </section>
    </div>}
  </section>;
}

function ArbitrageNotice({ title, body, icon, action }: { title: string; body: string; icon?: "loading"; action?: { href: string; label: string } }) {
  return <section className="market-auto-panel market-auto-notice">{icon === "loading" ? <LoaderCircle className="spin" /> : <ShieldCheck />}<div><h2>{title}</h2><p>{body}</p>{action && <Link className="button-primary automation-action" href={action.href}>{action.label}</Link>}</div></section>;
}
