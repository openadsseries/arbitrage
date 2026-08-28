"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Info, X } from "lucide-react";
import { formatUnits } from "viem";
import { ArbitrageRouteChecks } from "@/components/arbitrage-route-checks";
import type { DirectArbitrageExecutionQuote } from "@/lib/arbitrage";
import type { ArbitrageRouteCheck } from "@/lib/arbitrage-route-status";

function tokenAmount(raw: string, decimals: number) {
  return Number(formatUnits(BigInt(raw), decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 8,
  });
}

function wethAmount(raw: string) {
  return Number(formatUnits(BigInt(raw), 18)).toLocaleString("en-US", {
    maximumFractionDigits: 8,
  });
}

function usdAmount(
  raw: string,
  decimals: number,
  usd: number | null | undefined,
) {
  if (!usd) return null;
  const value = Number(formatUnits(BigInt(raw), decimals)) * usd;
  if (!Number.isFinite(value)) return null;
  const maximumFractionDigits = value > 0 && value < 0.01 ? 6 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits })}`;
}

function gasCoverage(quote: DirectArbitrageExecutionQuote | null) {
  if (!quote) return null;
  const needed = BigInt(quote.requiredWethRaw);
  if (needed <= 0n) return null;
  return Number((BigInt(quote.rewardWethRaw) * 1_000n) / needed) / 10;
}

export function arbitrageWatchCopy(reason: string) {
  if (reason === "Relay setup needed." || reason === "Relay not configured.") {
    return {
      title: "Setup needed",
      meaning: "Automatic execution is not connected to a relay wallet.",
      action: "Configure and fund the relay before starting arbitrage.",
    };
  }
  if (reason === "Relay needs Base ETH.") {
    return {
      title: "Relay needs gas",
      meaning:
        "The relay wallet does not have enough Base ETH to submit an execution.",
      action: "Add Base ETH to the relay wallet, then keep this page open.",
    };
  }
  if (reason === "Relay paused for today.") {
    return {
      title: "Paused today",
      meaning: "The relay reached its daily gas limit.",
      action: "It resumes automatically after the UTC day changes.",
    };
  }
  if (reason === "Fees are higher than profit." || reason === "Gas too high." || reason === "Waiting for gas.") {
    return {
      title: "Fees too high",
      meaning:
        "There is profit, but the relay reward is smaller than the gas needed to execute.",
      action:
        "Keep this browser open. It checks again automatically. A larger amount can also help.",
    };
  }
  if (reason === "Base is busy. Try again soon.") {
    return {
      title: "Network busy",
      meaning: "Base or the RPC endpoint is not responding cleanly right now.",
      action: "Keep the page open. It retries automatically.",
    };
  }
  if (reason === "No profitable route." || reason === "No route now." || reason === "Not executable now.") {
    return {
      title: "Watching",
      meaning:
        "The app is checking both directions, but the current route cannot execute profitably.",
      action:
        "Wait for the price gap to widen or use a market with deeper liquidity.",
    };
  }
  return {
    title: "Watching",
    meaning:
      "The route is being checked against price, liquidity, fees, and gas.",
    action: "Keep the page open. It runs when the full route is executable.",
  };
}

export function arbitrageWatchLabel(reason: string) {
  const title = arbitrageWatchCopy(reason).title;
  if (title === "Relay needs gas") return "Gas needed";
  if (title === "Paused today") return "Paused";
  if (title === "Fees too high") return "Fees too high";
  if (title === "Network busy") return "Network wait";
  return title;
}

export function arbitrageWatchPanelTitle(reason: string) {
  const title = arbitrageWatchCopy(reason).title;
  if (title === "Setup needed") return "Setup needed.";
  if (title === "Relay needs gas") return "Relay needs gas.";
  if (title === "Paused today") return "Paused today.";
  if (title === "Fees too high") return "Fees are higher than profit.";
  return "Watching prices.";
}

export function ArbitrageWatchHelp({
  reason,
  quote,
  reserveSymbol,
  reserveDecimals,
  checkedAt = null,
  trigger = "icon",
  checks = [],
  active = false,
}: {
  reason: string;
  quote: DirectArbitrageExecutionQuote | null;
  reserveSymbol: string;
  reserveDecimals: number;
  checkedAt?: number | null;
  trigger?: "icon" | "details";
  checks?: ArbitrageRouteCheck[];
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const copy = arbitrageWatchCopy(reason);
  const profitUsd =
    quote &&
    usdAmount(quote.expectedOwnerProfitRaw, reserveDecimals, quote.reserveUsd);
  const rewardUsd = quote && usdAmount(quote.rewardWethRaw, 18, quote.wethUsd);
  const gasUsd = quote && usdAmount(quote.requiredWethRaw, 18, quote.wethUsd);
  const coverage = gasCoverage(quote);
  const meaning =
    copy.title === "Fees too high" && coverage !== null
      ? `The relay reward covers ${coverage}% of gas, so it waits.`
      : copy.meaning;
  const checkedLabel = checkedAt
    ? new Date(checkedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;
  const relayLabel = quote
    ? "Ready"
    : copy.title === "Setup needed" || copy.title === "Relay needs gas"
      ? "Not ready"
      : "Checking";

  return (
    <>
      {trigger === "details" ? (
        <button
          className="market-details-trigger"
          onClick={() => setOpen(true)}
          type="button"
        >
          <Info /> Details
        </button>
      ) : (
        <button
          className="watch-help-trigger"
          aria-label="Explain status"
          onClick={() => setOpen(true)}
          type="button"
        >
          <CircleHelp />
        </button>
      )}
      {open && createPortal(
        <div
          className="market-details-layer"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <section
            className="market-details-dialog"
            aria-label="Arbitrage status"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="market-details-close"
              aria-label="Close status"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X />
            </button>
            <span className="kicker">Route status</span>
            <h2>{active ? copy.title : "How execution works"}</h2>
            {checks.length > 0 && (
              <ArbitrageRouteChecks checks={checks} showDetails />
            )}
            <div className="market-details-grid status-details-grid">
              <div>
                <strong>Current state</strong>
                <p>{active ? meaning : "One start keeps both directions under review."}</p>
              </div>
              <div>
                <strong>Next execution</strong>
                <p>
                  {active
                    ? copy.action
                    : "It runs only when Reserve, pool liquidity, fees, price impact, reward, and gas all pass."}
                </p>
              </div>
            </div>
            <p className="market-details-cycle">
              Each execution reduces the gap. Monitoring continues and runs again only after prices create a new executable route.
            </p>
            {checkedLabel && (
              <dl>
                <div>
                  <dt>Monitoring</dt>
                  <dd>Active in this browser</dd>
                </div>
                <div>
                  <dt>Last checked</dt>
                  <dd>{checkedLabel}</dd>
                </div>
                <div>
                  <dt>Relay</dt>
                  <dd>{relayLabel}</dd>
                </div>
                <div>
                  <dt>Execution</dt>
                  <dd>{copy.title}</dd>
                </div>
              </dl>
            )}
            {quote && (
              <dl>
                <div>
                  <dt>Profit</dt>
                  <dd>
                    +
                    {tokenAmount(quote.expectedOwnerProfitRaw, reserveDecimals)}{" "}
                    {reserveSymbol}
                    {profitUsd ? ` · ≈ ${profitUsd}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Relay reward</dt>
                  <dd>
                    {wethAmount(quote.rewardWethRaw)} WETH
                    {rewardUsd ? ` · ≈ ${rewardUsd}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Gas needed</dt>
                  <dd>
                    {wethAmount(quote.requiredWethRaw)} WETH
                    {gasUsd ? ` · ≈ ${gasUsd}` : ""}
                  </dd>
                </div>
                {coverage !== null && (
                  <div>
                    <dt>Gas covered</dt>
                    <dd>{coverage}%</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
