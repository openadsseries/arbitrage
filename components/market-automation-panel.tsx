"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";
import { ArbitrageRouteChecks } from "@/components/arbitrage-route-checks";
import { encodeFunctionData, formatUnits, type Address } from "viem";
import {
  ArbitrageWatchHelp,
  arbitrageWatchLabel,
  arbitrageWatchPanelTitle,
} from "@/components/arbitrage-watch-help";
import { useWallet } from "@/components/wallet-provider";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ARBITRAGE_EXECUTOR_V4_ABI,
  ARBITRAGE_V4_MIN_NET_RETURN_BPS,
  ERC20_PERMISSION_ABI,
  getArbitrageMaxFeeReimbursement,
  getArbitrageMinimumProfit,
  getArbitrageRepeatLimit,
  selectBestOpportunityRoute,
  type ArbitrageMarketReadiness,
  type ArbitrageExecutionReasonCode,
  type ArbitrageOpportunity,
  type ContinuousArbitrageSnapshot,
  type DirectArbitrageExecutionQuote,
} from "@/lib/arbitrage";
import { buildArbitrageRouteChecks } from "@/lib/arbitrage-route-status";
import type { ArbitrageRouteCheck } from "@/lib/arbitrage-route-status";
import { compactActionError as errorMessage } from "@/lib/errors";
import {
  readContinuousArbitrageSnapshot,
  refreshContinuousArbitrageSnapshot,
  useContinuousArbitrageSnapshot,
} from "@/lib/continuous-arbitrage-client";
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
  status?: "executed" | "ready" | "waiting-gas" | "unavailable" | "none";
  code?: ArbitrageExecutionReasonCode;
  hash?: `0x${string}`;
  execution?: DirectArbitrageExecutionQuote | null;
  error?: string;
};
type RelayStatus = {
  ready: boolean;
  state: "ready" | "low-balance" | "paused" | "setup-needed";
  message: string;
  balanceRaw: string | null;
  requiredBalanceRaw: string;
};

class RelayRequestError extends Error {
  payload: RelayPayload;

  constructor(message: string, payload: RelayPayload) {
    super(message);
    this.name = "RelayRequestError";
    this.payload = payload;
  }
}

const WATCH_VISIBLE_MS = 60_000;
const WATCH_WAITING_MS = 120_000;
const WATCH_HIDDEN_MS = 5 * 60_000;
const RELAY_COOLDOWN_MS = 12_000;
const RELAY_STATUS_MS = 10 * 60_000;
const RELAY_SAFETY_CHECK_MS = 5 * 60_000;
const RELAY_PROFIT_RECHECK_BPS = 500n;
const AUTO_REPEAT_COUNT = 10n;
const PASSIVE_WATCH_REASONS = new Set([
  "Base is busy. Try again soon.",
  "Gas too high.",
  "Fees are higher than profit.",
  "Price check unavailable.",
  "No profitable route.",
  "Not executable now.",
  "No route now.",
  "Waiting for gas.",
  "Relay needs Base ETH.",
  "Relay paused for today.",
]);

function watchDelay(reason: string) {
  if (document.visibilityState !== "visible") return WATCH_HIDDEN_MS;
  return PASSIVE_WATCH_REASONS.has(reason)
    ? WATCH_WAITING_MS
    : WATCH_VISIBLE_MS;
}

function relayWatchReason(reason: unknown) {
  if (reason instanceof RelayRequestError) {
    if (reason.payload.code === "fees-higher-than-profit")
      return "Fees are higher than profit.";
    if (reason.payload.code === "no-profitable-route")
      return "No profitable route.";
    if (reason.payload.code === "quote-unavailable")
      return "Price check unavailable.";
    if (reason.payload.code === "no-permission") return "No available amount.";
    if (reason.payload.status === "none") return errorMessage(reason.payload.error, "Watching.");
    return errorMessage(reason.payload.error, "Watching.");
  }
  return errorMessage(reason, "Watching.");
}

function reserveAmount(raw: string, decimals: number) {
  return Number(formatUnits(BigInt(raw), decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 8,
  });
}

function hasLiveMarketStrategy(
  snapshot: ContinuousArbitrageSnapshot,
  token: Address,
) {
  return snapshot.strategies.some(
    (strategy) =>
      strategy.hToken.toLowerCase() === token.toLowerCase() &&
      strategy.active &&
      BigInt(strategy.remainingVolumeRaw) > 0n &&
      (strategy.validUntil === 0 ||
        strategy.validUntil > snapshot.readTimestamp),
  );
}

type RelayProbeGate = {
  checkedAt: number;
  direction: ArbitrageOpportunity["routes"][number]["direction"];
  ownerProfitRaw: string;
  quote: DirectArbitrageExecutionQuote | null;
};

export function MarketAutomationPanel({
  market,
  initialReadiness,
  onActiveAmountChange,
  onActiveQuoteChange,
  onWatchReasonChange,
  onWatchCheckedAtChange,
  onRouteChecksChange,
  budget,
  budgetRaw,
  minimumBenchmarkRaw,
  onBudgetChange,
  estimatedProfitRaw,
  watchOpportunity,
}: {
  market: VerifiedMarket;
  initialReadiness: ArbitrageMarketReadiness | null;
  onActiveAmountChange?: (raw: string | null) => void;
  onActiveQuoteChange?: (quote: DirectArbitrageExecutionQuote | null) => void;
  onWatchReasonChange?: (reason: string) => void;
  onWatchCheckedAtChange?: (checkedAt: number | null) => void;
  onRouteChecksChange?: (checks: ArbitrageRouteCheck[]) => void;
  budget: string;
  budgetRaw: bigint | null;
  minimumBenchmarkRaw: bigint | null;
  onBudgetChange: (value: string) => void;
  estimatedProfitRaw: string | null;
  watchOpportunity: ArbitrageOpportunity | null;
}) {
  const wallet = useWallet();
  const snapshotState = useContinuousArbitrageSnapshot(wallet.address);
  const [readiness, setReadiness] = useState<ArbitrageMarketReadiness | null>(
    initialReadiness,
  );
  const [reserveBalanceRaw, setReserveBalanceRaw] = useState<bigint | null>(
    null,
  );
  const [reserveAllowanceRaw, setReserveAllowanceRaw] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [watchReason, setWatchReason] = useState("");
  const [lastRelayQuote, setLastRelayQuote] =
    useState<DirectArbitrageExecutionQuote | null>(null);
  const [lastWatchCheckedAt, setLastWatchCheckedAt] = useState<number | null>(
    null,
  );
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [showRevoke, setShowRevoke] = useState(false);
  const relayInFlight = useRef(false);
  const relayCooldownUntil = useRef(0);
  const relayProbeGate = useRef<RelayProbeGate | null>(null);
  const relayStatusCheckedAt = useRef(0);
  const watchReasonRef = useRef("");
  const watchRouteRef = useRef<
    ArbitrageOpportunity["routes"][number] | null
  >(null);
  const watchQuoteReadyRef = useRef(false);

  const readRelayStatus = useCallback(async () => {
    const response = await fetch("/api/arbitrage/relay", { cache: "no-store" });
    const payload = (await response.json()) as RelayStatus & { error?: string };
    if (!response.ok || typeof payload.ready !== "boolean") {
      throw new Error(payload.error ?? "Relay status unavailable.");
    }
    setRelayStatus(payload);
    return payload;
  }, []);

  useEffect(() => {
    let active = true;
    const check = (force = false) => {
      if (
        !force &&
        Date.now() - relayStatusCheckedAt.current < RELAY_STATUS_MS
      )
        return;
      void readRelayStatus()
        .then(() => {
          relayStatusCheckedAt.current = Date.now();
        })
        .catch((reason) => {
        if (!active) return;
        setRelayStatus({
          ready: false,
          state: "setup-needed",
          message: errorMessage(reason, "Relay setup needed."),
          balanceRaw: null,
          requiredBalanceRaw: "0",
        });
      });
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    check(true);
    const timer = window.setInterval(checkWhenVisible, RELAY_STATUS_MS);
    window.addEventListener("focus", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [readRelayStatus]);

  useEffect(() => {
    if (market.chain !== "base" || initialReadiness) return;
    const controller = new AbortController();
    fetch(`/api/arbitrage/readiness?chain=base&token=${market.token}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          readiness?: ArbitrageMarketReadiness;
          error?: string;
        };
        if (!response.ok || !payload.readiness)
          throw new Error(
            payload.error ?? "Could not read arbitrage readiness.",
          );
        setReadiness(payload.readiness);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setError(errorMessage(reason, "Could not read arbitrage readiness."));
      });
    return () => controller.abort();
  }, [initialReadiness, market.chain, market.token]);

  const preparation = useMemo<Preparation | null>(
    () =>
      readiness?.ready && readiness.executor
        ? {
            chain: "base",
            executor: readiness.executor,
            hToken: readiness.hToken,
            hSymbol: readiness.hSymbol,
            reserveToken: readiness.reserveToken,
            reserveSymbol: readiness.reserveSymbol,
            readBlock: readiness.readBlock,
          }
        : null,
    [readiness],
  );

  const refreshWalletState = useCallback(
    async (
      address: Address,
      nextPreparation: Preparation | null,
      force = false,
    ) => {
      const nextSnapshot = force
        ? await refreshContinuousArbitrageSnapshot(address)
        : await readContinuousArbitrageSnapshot(address);
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
    },
    [wallet],
  );

  const refreshSettledWalletState = useCallback(
    async (address: Address, nextPreparation: Preparation | null) => {
      return refreshWalletState(address, nextPreparation, true);
    },
    [refreshWalletState],
  );

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

  const activeSnapshot = wallet.address ? snapshotState.snapshot : null;
  const running = useMemo(
    () =>
      activeSnapshot?.strategies.find(
        (strategy) =>
          strategy.hToken.toLowerCase() === market.token.toLowerCase() &&
          strategy.active &&
          BigInt(strategy.remainingVolumeRaw) > 0n &&
          (strategy.validUntil === 0 ||
            strategy.validUntil > (activeSnapshot?.readTimestamp ?? 0)),
      ) ?? null,
    [activeSnapshot, market.token],
  );
  const budgetError =
    budgetRaw === null
      ? "Enter a valid amount."
      : minimumBenchmarkRaw !== null && budgetRaw < minimumBenchmarkRaw
        ? "Use at least the $10 benchmark."
      : reserveBalanceRaw !== null && budgetRaw > reserveBalanceRaw
        ? `Not enough ${market.reserveSymbol} in this wallet.`
        : "";
  const minimumProfitRaw = getArbitrageMinimumProfit(budgetRaw ?? 0n);
  const permissionRemaining = !running && reserveAllowanceRaw > 0n;
  const runningExecutions = useMemo(
    () =>
      activeSnapshot?.executions.filter(
        (execution) =>
          execution.strategyId === running?.id &&
          execution.version === running?.version,
      ) ?? [],
    [activeSnapshot, running?.id, running?.version],
  );
  const totalProfitRaw = runningExecutions.reduce(
    (total, execution) => total + BigInt(execution.ownerProfitReserveRaw),
    0n,
  );
  const relayReason = relayStatus?.ready === false ? relayStatus.message : "";
  const effectiveWatchReason = relayReason || watchReason;
  const activeStatusLabel = arbitrageWatchLabel(effectiveWatchReason);
  const watchRoute = useMemo(() => {
    if (
      !running ||
      watchOpportunity?.checkedAmountRaw !== running.maxReservePerExecutionRaw
    )
      return null;
    const route = selectBestOpportunityRoute(watchOpportunity);
    return route &&
      Boolean(route.netPositive ?? route.profitable) &&
      BigInt(route.ownerDifferenceRaw) > 0n
      ? route
      : null;
  }, [running, watchOpportunity]);
  const watchRouteReady = Boolean(watchRoute);
  const routeChecks = useMemo(
    () =>
      buildArbitrageRouteChecks({
        readiness,
        opportunity: watchOpportunity,
        reserveBalanceRaw: market.reserveBalanceRaw,
        active: Boolean(running),
        reason: effectiveWatchReason,
        quote: lastRelayQuote,
      }),
    [
      effectiveWatchReason,
      lastRelayQuote,
      market.reserveBalanceRaw,
      readiness,
      running,
      watchOpportunity,
    ],
  );
  useEffect(() => {
    onRouteChecksChange?.(routeChecks);
  }, [onRouteChecksChange, routeChecks]);

  useEffect(() => {
    watchRouteRef.current = watchRoute;
    watchQuoteReadyRef.current = Boolean(
      running &&
        watchOpportunity?.checkedAmountRaw ===
          running.maxReservePerExecutionRaw,
    );
  }, [running, watchOpportunity, watchRoute]);

  useEffect(() => {
    onActiveAmountChange?.(running?.maxReservePerExecutionRaw ?? null);
  }, [onActiveAmountChange, running?.maxReservePerExecutionRaw]);
  useEffect(() => {
    watchReasonRef.current = effectiveWatchReason;
    onWatchReasonChange?.(effectiveWatchReason);
  }, [effectiveWatchReason, onWatchReasonChange]);
  const relayStrategy = useCallback(
    async (address: Address, strategyId: string, version: "v3" | "v4") => {
      const response = await fetch("/api/arbitrage/relay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, strategyId, version }),
      });
      const payload = (await response.json()) as RelayPayload;
      if (!response.ok || !payload.hash)
        throw new RelayRequestError(payload.error ?? "Watching.", payload);
      return payload;
    },
    [],
  );

  const shouldProbeRelay = useCallback(async () => {
    const route = watchRouteRef.current;
    if (!route) return false;
    const gate = relayProbeGate.current;
    if (!gate) return true;
    if (gate.direction !== route.direction) return true;

    const previousProfit = BigInt(gate.ownerProfitRaw);
    const currentProfit = BigInt(route.ownerDifferenceRaw);
    if (
      previousProfit <= 0n ||
      currentProfit * 10_000n >=
        previousProfit * (10_000n + RELAY_PROFIT_RECHECK_BPS)
    )
      return true;
    if (Date.now() - gate.checkedAt >= RELAY_SAFETY_CHECK_MS) return true;

    const previousQuote = gate.quote;
    if (
      !previousQuote ||
      BigInt(previousQuote.gasPriceRaw) <= 0n ||
      BigInt(previousQuote.requiredWethRaw) <= 0n
    )
      return false;
    try {
      const client = await wallet.getPublicClient("base");
      const currentGasPrice = await client.getGasPrice();
      const projectedRequired =
        (BigInt(previousQuote.requiredWethRaw) * currentGasPrice) /
        BigInt(previousQuote.gasPriceRaw);
      return BigInt(previousQuote.rewardWethRaw) >= projectedRequired;
    } catch {
      return false;
    }
  }, [wallet]);

  useEffect(() => {
    if (
      !wallet.address ||
      !activeSnapshot?.executor ||
      !running ||
      !relayStatus?.ready
    )
      return;
    let active = true;
    let timeout: number | undefined;
    const run = async () => {
      if (!active) return;
      if (relayInFlight.current || Date.now() < relayCooldownUntil.current) {
        schedule();
        return;
      }
      const shouldProbe = await shouldProbeRelay();
      if (!active) return;
      const checkedAt = Date.now();
      setLastWatchCheckedAt(checkedAt);
      onWatchCheckedAtChange?.(checkedAt);
      if (!shouldProbe) {
        if (watchQuoteReadyRef.current && !watchRouteRef.current) {
          setWatchReason("No profitable route.");
          setLastRelayQuote(null);
          onActiveQuoteChange?.(null);
        } else if (watchRouteRef.current) {
          setWatchReason((current) =>
            current === "No profitable route." ? "" : current,
          );
        }
        schedule();
        return;
      }
      relayInFlight.current = true;
      try {
        const payload = await relayStrategy(
          wallet.address!,
          running.id,
          running.version,
        );
        const quote = payload.execution ?? null;
        setLastRelayQuote(quote);
        onActiveQuoteChange?.(quote);
        relayCooldownUntil.current = Date.now() + RELAY_COOLDOWN_MS;
        if (!active) return;
        setWatchReason("");
        relayProbeGate.current = null;
        setMessage("Executed. Still watching.");
        await refreshSettledWalletState(wallet.address!, preparation);
      } catch (reason) {
        if (active) {
          const text = relayWatchReason(reason);
          const quote =
            reason instanceof RelayRequestError
              ? (reason.payload.execution ?? null)
              : null;
          setLastRelayQuote(quote);
          onActiveQuoteChange?.(quote);
          setWatchReason(text);
          const route = watchRouteRef.current;
          if (route) {
            relayProbeGate.current = {
              checkedAt: Date.now(),
              direction: route.direction,
              ownerProfitRaw: route.ownerDifferenceRaw,
              quote,
            };
          }
          if (PASSIVE_WATCH_REASONS.has(text)) setError("");
        }
      } finally {
        relayInFlight.current = false;
        schedule();
      }
    };
    const schedule = () => {
      if (!active) return;
      timeout = window.setTimeout(
        () => void run(),
        watchDelay(watchReasonRef.current),
      );
    };
    void run();
    return () => {
      active = false;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [
    activeSnapshot?.executor,
    onActiveQuoteChange,
    onWatchCheckedAtChange,
    preparation,
    refreshSettledWalletState,
    relayStrategy,
    relayStatus?.ready,
    running,
    shouldProbeRelay,
    wallet.address,
    watchRouteReady,
  ]);

  async function execute() {
    if (!preparation || budgetRaw === null || budgetError) return;
    setBusy(true);
    setProgress("Connecting wallet");
    setError("");
    setMessage("");
    setWatchReason("");
    setLastWatchCheckedAt(null);
    onWatchCheckedAtChange?.(null);
    let approvalMayRemain = false;
    try {
      const currentRelayStatus = await readRelayStatus();
      if (!currentRelayStatus.ready)
        throw new Error(currentRelayStatus.message);
      const address = wallet.address ?? (await wallet.connect("base"));
      if (!address) throw new Error("Connect a wallet to execute.");
      const currentSnapshot =
        wallet.address && activeSnapshot
          ? activeSnapshot
          : await readContinuousArbitrageSnapshot(address);
      if (
        !currentSnapshot.configured ||
        !currentSnapshot.executor ||
        currentSnapshot.writeVersion !== "v4"
      )
        throw new Error("V4 setup is not ready yet.");

      const publicClient = await wallet.getPublicClient("base");
      const walletClient = await wallet.getWalletClient("base");
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({
          address: preparation.reserveToken,
          abi: ERC20_PERMISSION_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: preparation.reserveToken,
          abi: ERC20_PERMISSION_ABI,
          functionName: "allowance",
          args: [address, currentSnapshot.executor],
        }),
      ]);
      if (balance < budgetRaw)
        throw new Error(`Not enough ${market.reserveSymbol} in this wallet.`);
      const totalLimitRaw = getArbitrageRepeatLimit(
        budgetRaw,
        balance,
        AUTO_REPEAT_COUNT,
      );
      const validUntil = 0;
      const maximumFeeReimbursementRaw =
        getArbitrageMaxFeeReimbursement(budgetRaw);
      const startCall = {
        to: currentSnapshot.executor,
        data: encodeFunctionData({
          abi: ARBITRAGE_EXECUTOR_V4_ABI,
          functionName: "startStrategy",
          args: [
            market.token,
            budgetRaw,
            totalLimitRaw,
            minimumProfitRaw,
            ARBITRAGE_V4_MIN_NET_RETURN_BPS,
            maximumFeeReimbursementRaw,
            validUntil,
          ],
        }),
      } as const;
      const approvalCalls =
        allowance === totalLimitRaw
          ? []
          : [
              ...(allowance > 0n
                ? [
                    {
                      to: preparation.reserveToken,
                      data: encodeFunctionData({
                        abi: ERC20_PERMISSION_ABI,
                        functionName: "approve",
                        args: [currentSnapshot.executor, 0n],
                      }),
                    },
                  ]
                : []),
              {
                to: preparation.reserveToken,
                data: encodeFunctionData({
                  abi: ERC20_PERMISSION_ABI,
                  functionName: "approve",
                  args: [currentSnapshot.executor, totalLimitRaw],
                }),
              },
            ];

      let atomicStarted = false;
      if (approvalCalls.length > 0) {
        setProgress("Confirm in your wallet");
        atomicStarted = await sendAtomicCallsIfSupported({
          getCapabilities: () =>
            walletClient.getCapabilities({ account: address, chainId: 8453 }),
          sendCalls: () =>
            walletClient.sendCalls({
              account: address,
              calls: [...approvalCalls, startCall],
              forceAtomic: true,
            }),
          waitForCallsStatus: (id) =>
            walletClient.waitForCallsStatus({
              id,
              throwOnFailure: true,
              timeout: 120_000,
            }),
        });
      }

      if (!atomicStarted) {
        for (const [index, call] of approvalCalls.entries()) {
          setProgress(
            index === approvalCalls.length - 1
              ? `Approving ${market.reserveSymbol}`
              : "Resetting approval",
          );
          const hash = await walletClient.sendTransaction({
            account: address,
            chain: undefined,
            to: call.to,
            data: call.data,
          });
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
          });
          if (receipt.status !== "success")
            throw new Error(
              `${market.reserveSymbol} approval did not confirm.`,
            );
          if (index === approvalCalls.length - 1) approvalMayRemain = true;
        }
        setProgress("Prepare");
        const request = await publicClient.simulateContract({
          account: address,
          address: currentSnapshot.executor,
          abi: ARBITRAGE_EXECUTOR_V4_ABI,
          functionName: "startStrategy",
          args: [
            market.token,
            budgetRaw,
            totalLimitRaw,
            minimumProfitRaw,
            ARBITRAGE_V4_MIN_NET_RETURN_BPS,
            maximumFeeReimbursementRaw,
            validUntil,
          ],
        });
        const hash = await walletClient.writeContract(request.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error("Preparation failed.");
      }
      setShowRevoke(false);
      const strategyId = await publicClient.readContract({
        address: currentSnapshot.executor,
        abi: ARBITRAGE_EXECUTOR_V4_ABI,
        functionName: "activeStrategyId",
        args: [address, market.token],
        blockTag: "pending",
      });
      if (strategyId === 0n) throw new Error("Position not found.");
      let executed = false;
      try {
        setProgress("Execute");
        const payload = await relayStrategy(
          address,
          strategyId.toString(),
          "v4",
        );
        const quote = payload.execution ?? null;
        setLastRelayQuote(quote);
        onActiveQuoteChange?.(quote);
        relayCooldownUntil.current = Date.now() + RELAY_COOLDOWN_MS;
        executed = true;
      } catch (reason) {
        const text = relayWatchReason(reason);
        const quote =
          reason instanceof RelayRequestError
            ? (reason.payload.execution ?? null)
            : null;
        setLastRelayQuote(quote);
        onActiveQuoteChange?.(quote);
        setWatchReason(text);
        if (!PASSIVE_WATCH_REASONS.has(text)) setError(text);
      }
      const nextSnapshot = await refreshSettledWalletState(
        address,
        preparation,
      );
      setMessage(
        executed
          ? hasLiveMarketStrategy(nextSnapshot, market.token)
            ? "Executed. Still watching."
            : "Executed."
          : "Watching.",
      );
    } catch (reason) {
      if (approvalMayRemain) setShowRevoke(true);
      setError(errorMessage(reason, "Could not execute."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function stopAndRevoke() {
    if (
      !wallet.address ||
      !running ||
      !preparation
    )
      return;
    setBusy(true);
    setProgress("Stopping arbitrage");
    setError("");
    setWatchReason("");
    try {
      const publicClient = await wallet.getPublicClient("base");
      const walletClient = await wallet.getWalletClient("base");
      const strategyExecutor = running.executor;
      const strategyAbi =
        running.version === "v4"
          ? ARBITRAGE_EXECUTOR_V4_ABI
          : ARBITRAGE_EXECUTOR_V3_ABI;
      const currentAllowance = await publicClient.readContract({
        address: preparation.reserveToken,
        abi: ERC20_PERMISSION_ABI,
        functionName: "allowance",
        args: [wallet.address, strategyExecutor],
      });
      const stopCall = {
        to: strategyExecutor,
        data: encodeFunctionData({
          abi: strategyAbi,
          functionName: "stopStrategy",
          args: [BigInt(running.id)],
        }),
      } as const;
      const revokeCall = {
        to: preparation.reserveToken,
        data: encodeFunctionData({
          abi: ERC20_PERMISSION_ABI,
          functionName: "approve",
          args: [strategyExecutor, 0n],
        }),
      } as const;
      const calls =
        currentAllowance > 0n ? [stopCall, revokeCall] : [stopCall];
      const atomicStopped = await sendAtomicCallsIfSupported({
        getCapabilities: () =>
          walletClient.getCapabilities({
            account: wallet.address!,
            chainId: 8453,
          }),
        sendCalls: () =>
          walletClient.sendCalls({
            account: wallet.address!,
            calls,
            forceAtomic: true,
          }),
        waitForCallsStatus: (id) =>
          walletClient.waitForCallsStatus({
            id,
            throwOnFailure: true,
            timeout: 120_000,
          }),
      });
      if (!atomicStopped) {
        for (const [index, call] of calls.entries()) {
          setProgress(
            index === 0 ? "Stopping arbitrage" : "Removing permission",
          );
          const hash = await walletClient.sendTransaction({
            account: wallet.address,
            chain: undefined,
            to: call.to,
            data: call.data,
          });
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
          });
          if (receipt.status !== "success") {
            if (index === 0) throw new Error("Arbitrage did not stop.");
            throw new Error(
              "Arbitrage stopped, but the remaining permission was not removed.",
            );
          }
        }
      }
      setShowRevoke(false);
      setReserveAllowanceRaw(0n);
      setLastWatchCheckedAt(null);
      onWatchCheckedAtChange?.(null);
      setMessage("Arbitrage stopped and permission removed.");
      await refreshSettledWalletState(wallet.address, preparation);
    } catch (reason) {
      setShowRevoke(true);
      setError(
        errorMessage(reason, "Could not stop arbitrage and remove permission."),
      );
      await refreshSettledWalletState(wallet.address, preparation).catch(
        () => undefined,
      );
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
      const request = await publicClient.simulateContract({
        account: wallet.address,
        address: preparation.reserveToken,
        abi: ERC20_PERMISSION_ABI,
        functionName: "approve",
        args: [activeSnapshot.executor, 0n],
      });
      const hash = await walletClient.writeContract(request.request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("The wallet limit was not removed.");
      setShowRevoke(false);
      setReserveAllowanceRaw(0n);
      setMessage(`${market.reserveSymbol} permission removed.`);
    } catch (reason) {
      setError(errorMessage(reason, "Could not remove the wallet limit."));
    } finally {
      setBusy(false);
    }
  }

  if (market.chain !== "base")
    return (
      <ArbitrageNotice
        title="Not available on this network"
        body="Arbitrage is available on Base first."
      />
    );
  if (!readiness)
    return (
      <ArbitrageNotice
        title="Arbitrage status unavailable"
        body="Refresh to check both markets again."
      />
    );
  if (!readiness.originalMarket.ready)
    return (
      <ArbitrageNotice
        title={`${market.reserveSymbol} cannot be compared yet`}
        body={`A live ${market.reserveSymbol} market is required.`}
      />
    );
  if (!readiness.hypedMarket.ready)
    return (
      <ArbitrageNotice
        title={`${market.symbol} needs a pool`}
        body="Create its independent market before checking arbitrage."
        action={{
          href: `/launch/market?token=${market.token}`,
          label: `Create ${market.symbol} pool`,
        }}
      />
    );
  if (!readiness.executorReady)
    return (
      <ArbitrageNotice
        title="Arbitrage temporarily unavailable"
        body="The Reserve Token execution update has not been deployed yet."
      />
    );
  if (wallet.address && !activeSnapshot)
    return (
      <ArbitrageNotice
        icon="loading"
        title="Reading arbitrage"
        body="Only confirmed Base state is shown."
      />
    );
  if (activeSnapshot && !activeSnapshot.configured)
    return (
      <ArbitrageNotice
        title="Arbitrage contract not recorded"
        body="The Reserve Token executor is not configured in this deployment."
      />
    );

  return (
    <section className="market-auto-panel">
      {running ? (
        <>
          <div className="market-auto-status">
            <span>
              <i /> {activeStatusLabel}
              <ArbitrageWatchHelp
                reason={effectiveWatchReason}
                quote={lastRelayQuote}
                reserveSymbol={market.reserveSymbol}
                reserveDecimals={market.reserveDecimals}
                checkedAt={lastWatchCheckedAt}
              />
            </span>
            <small>{effectiveWatchReason || "This browser"}</small>
          </div>
          <h2>{arbitrageWatchPanelTitle(effectiveWatchReason)}</h2>
          <ArbitrageRouteChecks checks={routeChecks} />
          <dl className="market-auto-summary">
            <div>
              <dt>Profit</dt>
              <dd className="positive">
                +
                {reserveAmount(
                  totalProfitRaw.toString(),
                  market.reserveDecimals,
                )}{" "}
                {market.reserveSymbol}
              </dd>
            </div>
            <div>
              <dt>Executions</dt>
              <dd>{running.executionCount}</dd>
            </div>
            <div>
              <dt>Budget left</dt>
              <dd>
                {reserveAmount(
                  running.remainingVolumeRaw,
                  market.reserveDecimals,
                )}{" "}
                {market.reserveSymbol}
              </dd>
            </div>
          </dl>
          <div className="market-auto-actions">
            <button
              className="market-auto-stop"
              disabled={busy}
              onClick={() => void stopAndRevoke()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" /> : <Pause />} Stop
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="kicker">2 · Start</span>
          <div className="market-auto-budget">
            <label htmlFor="arbitrage-budget">Per run</label>
            <div className="market-auto-budget-input">
              <input
                id="arbitrage-budget"
                inputMode="decimal"
                min="0"
                onChange={(event) => onBudgetChange(event.target.value)}
                placeholder="1"
                step="any"
                type="number"
                value={budget}
              />
              <span>{market.reserveSymbol}</span>
            </div>
            <dl className="market-auto-budget-meta">
              <div>
                <dt>Available</dt>
                <dd>
                  {wallet.address && reserveBalanceRaw !== null
                    ? `${reserveAmount(reserveBalanceRaw.toString(), market.reserveDecimals)} ${market.reserveSymbol}`
                    : "Connect wallet"}
                </dd>
              </div>
              <div>
                <dt>Route estimate</dt>
                <dd className={estimatedProfitRaw ? "positive" : ""}>
                  {estimatedProfitRaw
                    ? `+${reserveAmount(estimatedProfitRaw, market.reserveDecimals)} ${market.reserveSymbol}`
                    : "—"}
                </dd>
              </div>
            </dl>
            {budgetError && <em>{budgetError}</em>}
          </div>
          <ArbitrageRouteChecks checks={routeChecks} />
          <button
            className="button-primary automation-action"
            disabled={
              busy ||
              !preparation ||
              Boolean(budgetError) ||
              !relayStatus?.ready
            }
            onClick={() => void execute()}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" /> : <Play />}{" "}
            {busy
              ? progress
              : !relayStatus
                ? "Checking setup"
                : !relayStatus.ready
                  ? "Setup needed"
                  : preparation
                    ? "Start arbitrage"
                    : "Preparing"}
          </button>
        </>
      )}

      {message && (
        <div className="market-auto-message">
          <CheckCircle2 /> {message}
        </div>
      )}
      {error && (
        <div className="market-auto-error">
          <ShieldCheck /> {error}
        </div>
      )}
      {(showRevoke || permissionRemaining) && !running && (
        <button
          className="market-auto-revoke"
          disabled={busy}
          onClick={() => void revoke()}
          type="button"
        >
          Remove permission
        </button>
      )}
      <ArbitrageWatchHelp
        trigger="details"
        reason={effectiveWatchReason}
        quote={lastRelayQuote}
        reserveSymbol={market.reserveSymbol}
        reserveDecimals={market.reserveDecimals}
        checkedAt={running ? lastWatchCheckedAt : null}
        checks={routeChecks}
        active={Boolean(running)}
      />
    </section>
  );
}

function ArbitrageNotice({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body: string;
  icon?: "loading";
  action?: { href: string; label: string };
}) {
  return (
    <section className="market-auto-panel market-auto-notice">
      {icon === "loading" ? <LoaderCircle className="spin" /> : <ShieldCheck />}
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
        {action && (
          <Link className="button-primary automation-action" href={action.href}>
            {action.label}
          </Link>
        )}
      </div>
    </section>
  );
}
