"use client";

import { useState } from "react";
import { CircleHelp, Info, X } from "lucide-react";
import { formatUnits } from "viem";
import type { DirectArbitrageExecutionQuote } from "@/lib/arbitrage";

function tokenAmount(raw: string, decimals: number) {
  return Number(formatUnits(BigInt(raw), decimals)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function wethAmount(raw: string) {
  return Number(formatUnits(BigInt(raw), 18)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function usdAmount(raw: string, decimals: number, usd: number | null | undefined) {
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
  return Number(BigInt(quote.rewardWethRaw) * 1_000n / needed) / 10;
}

function statusCopy(reason: string) {
  if (reason === "Gas too high." || reason === "Waiting for gas.") {
    return {
      title: "Waiting for gas",
      meaning: "There is profit, but the relay reward is smaller than the gas needed to execute.",
      action: "Use a larger amount, wait for lower gas, or raise the executor reward in a future strategy.",
    };
  }
  if (reason === "Base is busy. Try again soon.") {
    return {
      title: "Network busy",
      meaning: "Base or the RPC endpoint is not responding cleanly right now.",
      action: "Keep the page open. It retries automatically.",
    };
  }
  if (reason === "No route now." || reason === "Not executable now.") {
    return {
      title: "Watching",
      meaning: "The app is checking both directions, but the current route cannot execute profitably.",
      action: "Wait for the price gap to widen or use a market with deeper liquidity.",
    };
  }
  return {
    title: "Watching",
    meaning: "The route is being checked against price, liquidity, fees, and gas.",
    action: "Keep the page open. It runs when the full route is executable.",
  };
}

export function ArbitrageWatchHelp({
  reason,
  quote,
  reserveSymbol,
  reserveDecimals,
  trigger = "icon",
}: {
  reason: string;
  quote: DirectArbitrageExecutionQuote | null;
  reserveSymbol: string;
  reserveDecimals: number;
  trigger?: "icon" | "details";
}) {
  const [open, setOpen] = useState(false);
  const copy = statusCopy(reason);
  const profitUsd = quote && usdAmount(quote.expectedOwnerProfitRaw, reserveDecimals, quote.reserveUsd);
  const rewardUsd = quote && usdAmount(quote.rewardWethRaw, 18, quote.wethUsd);
  const gasUsd = quote && usdAmount(quote.requiredWethRaw, 18, quote.wethUsd);
  const coverage = gasCoverage(quote);
  const meaning = copy.title === "Waiting for gas" && coverage !== null
    ? `The relay reward covers ${coverage}% of gas, so it waits.`
    : copy.meaning;

  return <>
    {trigger === "details"
      ? <button className="market-details-trigger" onClick={() => setOpen(true)} type="button"><Info /> Details</button>
      : <button className="watch-help-trigger" aria-label="Explain status" onClick={() => setOpen(true)} type="button"><CircleHelp /></button>}
    {open && <div className="market-details-layer" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="market-details-dialog" aria-label="Arbitrage status" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="market-details-close" aria-label="Close status" onClick={() => setOpen(false)} type="button"><X /></button>
        <span className="kicker">Status</span>
        <h2>{copy.title}</h2>
        <div className="market-details-grid status-details-grid">
          <div><strong>Meaning</strong><p>{meaning}</p></div>
          <div><strong>What helps</strong><p>{copy.action}</p></div>
        </div>
        {quote && <dl>
          <div><dt>Profit</dt><dd>+{tokenAmount(quote.expectedOwnerProfitRaw, reserveDecimals)} {reserveSymbol}{profitUsd ? ` · ≈ ${profitUsd}` : ""}</dd></div>
          <div><dt>Relay reward</dt><dd>{wethAmount(quote.rewardWethRaw)} WETH{rewardUsd ? ` · ≈ ${rewardUsd}` : ""}</dd></div>
          <div><dt>Gas needed</dt><dd>{wethAmount(quote.requiredWethRaw)} WETH{gasUsd ? ` · ≈ ${gasUsd}` : ""}</dd></div>
        </dl>}
      </section>
    </div>}
  </>;
}
