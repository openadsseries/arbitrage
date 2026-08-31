"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";
import { formatUnits, getAddress, isAddress, parseUnits, type Hash, type Hex } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { CHAINS } from "@/lib/chains";
import { compact } from "@/lib/format";
import type { VerifiedMarket } from "@/lib/onchain-types";

type Quote = {
  inputAmount: bigint;
  outputAmount: bigint;
  feeAmount: bigint | null;
  priceImpact: number | null;
  feeBips: number;
};
type TradeSide = "buy" | "sell";

type SwapTransaction = {
  to: string;
  from: string;
  data: string;
  value: string;
  chainId: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
};

function display(value: bigint, decimals: number) {
  return compact(Number(formatUnits(value, decimals)), 6);
}

function readableError(reason: unknown) {
  if (reason instanceof Error) {
    if (reason.message.includes("User rejected") || reason.message.includes("User denied")) return "The wallet request was cancelled.";
    if (reason.message.includes("insufficient funds")) return "The wallet does not have enough ETH for this trade and gas.";
    return reason.message.split("\n")[0];
  }
  return "The Uniswap trade could not be prepared.";
}

async function requestSwap(body: Record<string, string>) {
  const response = await fetch("/api/uniswap/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as {
    outputAmountRaw?: string;
    feeAmountRaw?: string | null;
    priceImpact?: number | null;
    feeBips?: number;
    swap?: SwapTransaction;
    approval?: SwapTransaction | null;
    cancel?: SwapTransaction | null;
    setupRequired?: boolean;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.setupRequired ? "Trading is temporarily unavailable." : payload.error ?? "A live Uniswap quote is unavailable.");
  return payload;
}

export function OgSwapPanel({ market, onClose, embedded = false }: { market: VerifiedMarket; onClose?: () => void; embedded?: boolean }) {
  const wallet = useWallet();
  const [side, setSide] = useState<TradeSide>("buy");
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);

  const parsedAmount = useMemo(() => {
    try {
      const amount = parseUnits(input || "0", side === "buy" ? 18 : market.reserveDecimals);
      return amount > 0n ? amount : null;
    } catch {
      return null;
    }
  }, [input, market.reserveDecimals, side]);
  const activeQuote = quote && parsedAmount === quote.inputAmount ? quote : null;

  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!parsedAmount || !wallet.address) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setQuoting(true);
      setError("");
      try {
        const payload = await requestSwap({
          action: "quote",
          chain: market.chain,
          token: market.reserveToken,
          side,
          amountRaw: parsedAmount.toString(),
          swapper: wallet.address!,
        });
        if (!payload.outputAmountRaw || payload.feeBips === undefined) throw new Error("Uniswap returned an incomplete quote.");
        setQuote({
          inputAmount: parsedAmount,
          outputAmount: BigInt(payload.outputAmountRaw),
          feeAmount: payload.feeAmountRaw ? BigInt(payload.feeAmountRaw) : null,
          priceImpact: payload.priceImpact ?? null,
          feeBips: payload.feeBips,
        });
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(readableError(reason));
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [market.chain, market.reserveToken, parsedAmount, side, wallet.address]);

  function changeSide(next: TradeSide) {
    if (next === side) return;
    setSide(next);
    setInput("");
    setQuote(null);
    setError("");
    setTransactionHash(null);
  }

  async function trade(event: FormEvent) {
    event.preventDefault();
    if (!wallet.address) {
      await wallet.connect(market.chain);
      return;
    }
    if (!parsedAmount || status) return;
    setStatus("Preparing trade");
    setError("");
    setTransactionHash(null);
    try {
      const account = wallet.address;
      const publicClient = await wallet.getPublicClient(market.chain);
      const walletClient = await wallet.getWalletClient(market.chain);

      async function sendPrepared(prepared: SwapTransaction, label: string) {
        if (!isAddress(prepared.to) || !isAddress(prepared.from) || !prepared.data || prepared.data === "0x") {
          throw new Error(`Uniswap returned an invalid ${label.toLowerCase()}.`);
        }
        if (getAddress(prepared.from) !== account || prepared.chainId !== CHAINS[market.chain].id) {
          throw new Error(`The ${label.toLowerCase()} does not match the connected wallet or network.`);
        }
        const request = {
          account,
          to: getAddress(prepared.to),
          data: prepared.data as Hex,
          value: BigInt(prepared.value),
        };
        await publicClient.call(request);
        const hash = await walletClient.sendTransaction({ ...request, chain: undefined });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${label} did not confirm.`);
        return hash;
      }

      if (side === "sell") {
        setStatus(`Approve ${market.reserveSymbol}`);
        const approval = await requestSwap({
          action: "approval",
          chain: market.chain,
          token: market.reserveToken,
          side,
          amountRaw: parsedAmount.toString(),
          swapper: account,
        });
        if (approval.cancel) await sendPrepared(approval.cancel, "Approval reset");
        if (approval.approval) await sendPrepared(approval.approval, "Approval");
      }

      setStatus("Confirm in wallet");
      const payload = await requestSwap({
        action: "transaction",
        chain: market.chain,
        token: market.reserveToken,
        side,
        amountRaw: parsedAmount.toString(),
        swapper: account,
      });
      const swap = payload.swap;
      if (!swap || !isAddress(swap.to) || !isAddress(swap.from) || !swap.data || swap.data === "0x") {
        throw new Error("Uniswap returned an invalid transaction.");
      }
      if (getAddress(swap.from) !== account || swap.chainId !== CHAINS[market.chain].id) {
        throw new Error("The trade does not match the connected wallet or network.");
      }
      const hash = await sendPrepared(swap, "Trade");
      setTransactionHash(hash);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setStatus("");
    }
  }

  const content = transactionHash ? (
          <div className="buy-success">
            <CheckCircle2 />
            <h2 id="og-buy-title">{side === "buy" ? "Purchase" : "Sale"} complete.</h2>
            <p>The Uniswap transaction confirmed on {CHAINS[market.chain].name}.</p>
            <a href={`${CHAINS[market.chain].explorerUrl}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink /></a>
          </div>
        ) : (
          <form data-trade-side={side} onSubmit={trade}>
            <span className="kicker">Uniswap</span>
            <div className="trade-side-tabs" role="tablist" aria-label={`Trade ${market.reserveSymbol}`}>
              <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "selected" : ""} onClick={() => changeSide("buy")}>Buy</button>
              <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "selected" : ""} onClick={() => changeSide("sell")}>Sell</button>
            </div>
            <h2 id="og-buy-title">{side === "buy" ? "Buy" : "Sell"} {market.reserveSymbol}</h2>
            <label className="buy-amount">
              <span>{side === "buy" ? "You pay" : "You sell"}</span>
              <div><input autoFocus={!embedded} inputMode="decimal" placeholder="0" value={input} onChange={(event) => setInput(event.target.value)} /><strong>{side === "buy" ? "ETH" : market.reserveSymbol}</strong></div>
            </label>
            <div className="buy-quote">
              <span>You receive</span>
              <strong>{quoting ? <LoaderCircle className="spin" /> : activeQuote ? `${display(activeQuote.outputAmount, side === "buy" ? market.reserveDecimals : 18)} ${side === "buy" ? market.reserveSymbol : "ETH"}` : "—"}</strong>
            </div>
            {error && <p className="form-error">{error}</p>}
            <button className="button-primary buy-submit" disabled={Boolean(status) || Boolean(wallet.address && (!activeQuote || quoting))} type="submit">
              {status ? <><LoaderCircle className="spin" /> {status}</> : wallet.address ? `${side === "buy" ? "Buy" : "Sell"} ${market.reserveSymbol}` : "Connect wallet"}
            </button>
            <details className="trade-price-details">
              <summary>Price details</summary>
              <div><span>Service fee</span><strong>1%</strong></div>
              <div><span>Maximum price movement</span><strong>0.5%</strong></div>
              {activeQuote?.priceImpact !== null && activeQuote?.priceImpact !== undefined && <div><span>Price impact</span><strong>{activeQuote.priceImpact.toFixed(2)}%</strong></div>}
            </details>
          </form>
        );

  if (embedded) return <section className="buy-panel buy-panel-inline" aria-labelledby="og-buy-title">{content}</section>;

  return (
    <div className="buy-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="buy-panel" role="dialog" aria-modal="true" aria-labelledby="og-buy-title">
        <button className="icon-button buy-close" type="button" aria-label="Close" onClick={onClose}><X /></button>
        {content}
      </section>
    </div>
  );
}
