"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BOND_ABI, ERC20_ABI } from "@mint.club/v2-sdk";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";
import { formatUnits, parseUnits, type Hash } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { CHAINS } from "@/lib/chains";
import { compact } from "@/lib/format";
import type { VerifiedMarket } from "@/lib/onchain-types";

type Quote = {
  tokenAmount: bigint;
  reserveAmount: bigint;
  royalty: bigint;
};
type TradeSide = "buy" | "sell";

function displayAmount(value: bigint, decimals: number) {
  const number = Number(formatUnits(value, decimals));
  return Number.isFinite(number) ? compact(number, 4) : "—";
}

function readableError(reason: unknown) {
  if (reason instanceof Error) {
    if (reason.message.includes("User rejected") || reason.message.includes("User denied")) return "The wallet request was cancelled.";
    if (reason.message.includes("insufficient funds")) return "The wallet does not have enough funds for this transaction.";
    return reason.message.split("\n")[0];
  }
  return "The transaction could not be prepared.";
}

export function QuickBuyPanel({ market, onClose, embedded = false }: { market: VerifiedMarket; onClose?: () => void; embedded?: boolean }) {
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
      const amount = parseUnits(input || "0", market.decimals);
      return amount > 0n ? amount : null;
    } catch {
      return null;
    }
  }, [input, market.decimals]);
  const activeQuote = quote && parsedAmount === quote.tokenAmount ? quote : null;

  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!parsedAmount) return;
    const timer = window.setTimeout(async () => {
      setQuoting(true);
      setError("");
      try {
        const response = await fetch("/api/market/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chain: market.chain, token: market.token, tokenAmountRaw: parsedAmount.toString(), side }),
        });
        const payload = await response.json() as { reserveAmountRaw?: string; royaltyRaw?: string; error?: string };
        if (!response.ok || !payload.reserveAmountRaw || payload.royaltyRaw === undefined) {
          throw new Error(payload.error ?? "A live price is unavailable.");
        }
        setQuote({ tokenAmount: parsedAmount, reserveAmount: BigInt(payload.reserveAmountRaw), royalty: BigInt(payload.royaltyRaw) });
      } catch (reason) {
        setError(readableError(reason));
      } finally {
        setQuoting(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [market.chain, market.token, parsedAmount, side]);

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
    if (!activeQuote || status) return;
    setError("");
    setTransactionHash(null);
    try {
      const account = wallet.address ?? await wallet.connect(market.chain);
      if (!account) return;
      setStatus("Checking price");
      const walletClient = await wallet.getWalletClient(market.chain);
      const publicClient = await wallet.getPublicClient(market.chain);
      const freshQuote = side === "buy"
        ? await publicClient.readContract({
            address: CHAINS[market.chain].mintClubBond,
            abi: BOND_ABI,
            functionName: "getReserveForToken",
            args: [market.token, activeQuote.tokenAmount],
          })
        : await publicClient.readContract({
            address: CHAINS[market.chain].mintClubBond,
            abi: BOND_ABI,
            functionName: "getRefundForTokens",
            args: [market.token, activeQuote.tokenAmount],
          });
      const reserveAmount = freshQuote[0];
      const priceLimit = side === "buy"
        ? reserveAmount + ((reserveAmount + 99n) / 100n)
        : reserveAmount - ((reserveAmount + 99n) / 100n);
      const spendToken = side === "buy" ? market.reserveToken : market.token;
      const spendSymbol = side === "buy" ? market.reserveSymbol : market.symbol;
      const spendAmount = side === "buy" ? priceLimit : activeQuote.tokenAmount;
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({
          address: spendToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account],
        }),
        publicClient.readContract({
          address: spendToken,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account, CHAINS[market.chain].mintClubBond],
        }),
      ]);
      if (balance < spendAmount) throw new Error(`Not enough ${spendSymbol} in this wallet.`);

      if (allowance < spendAmount) {
        setStatus(`Approve ${spendSymbol}`);
        const approval = await publicClient.simulateContract({
          address: spendToken,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CHAINS[market.chain].mintClubBond, spendAmount],
          account,
        });
        const approvalHash = await walletClient.writeContract(approval.request);
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error(`${spendSymbol} approval did not confirm.`);
      }

      setStatus(side === "buy" ? "Confirm purchase" : "Confirm sale");
      const latestQuote = side === "buy"
        ? await publicClient.readContract({
            address: CHAINS[market.chain].mintClubBond,
            abi: BOND_ABI,
            functionName: "getReserveForToken",
            args: [market.token, activeQuote.tokenAmount],
          })
        : await publicClient.readContract({
            address: CHAINS[market.chain].mintClubBond,
            abi: BOND_ABI,
            functionName: "getRefundForTokens",
            args: [market.token, activeQuote.tokenAmount],
          });
      if (side === "buy" && latestQuote[0] > priceLimit) throw new Error("The price moved by more than 1%. Review the new amount and try again.");
      if (side === "sell" && latestQuote[0] < priceLimit) throw new Error("The price moved by more than 1%. Review the new amount and try again.");
      let hash: Hash;
      if (side === "buy") {
        const simulation = await publicClient.simulateContract({
            address: CHAINS[market.chain].mintClubBond,
            abi: BOND_ABI,
            functionName: "mint",
            args: [market.token, activeQuote.tokenAmount, priceLimit, account],
            account,
          });
        hash = await walletClient.writeContract(simulation.request);
      } else {
        const simulation = await publicClient.simulateContract({
            address: CHAINS[market.chain].mintClubBond,
            abi: BOND_ABI,
            functionName: "burn",
            args: [market.token, activeQuote.tokenAmount, priceLimit, account],
            account,
          });
        hash = await walletClient.writeContract(simulation.request);
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction did not confirm.");
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
            <h2 id="buy-title">{side === "buy" ? "Purchase" : "Sale"} complete.</h2>
            <p>The transaction confirmed on {CHAINS[market.chain].name}.</p>
            <a href={`${CHAINS[market.chain].explorerUrl}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink /></a>
          </div>
        ) : (
          <form data-trade-side={side} onSubmit={trade}>
            <span className="kicker">Direct exchange</span>
            <div className="trade-side-tabs" role="tablist" aria-label={`Trade ${market.symbol}`}>
              <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "selected" : ""} onClick={() => changeSide("buy")}>Buy</button>
              <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "selected" : ""} onClick={() => changeSide("sell")}>Sell</button>
            </div>
            <h2 id="buy-title">{side === "buy" ? "Buy" : "Sell"} {market.symbol}</h2>
            <label className="buy-amount">
              <span>{side === "buy" ? "You receive" : "You sell"}</span>
              <div><input autoFocus={!embedded} inputMode="decimal" placeholder="0" value={input} onChange={(event) => setInput(event.target.value)} /><strong>{market.symbol}</strong></div>
            </label>
            <div className="buy-quote">
              <span>{side === "buy" ? "You pay" : "You receive"}</span>
              <strong>{quoting ? <LoaderCircle className="spin" /> : activeQuote ? `${displayAmount(activeQuote.reserveAmount, market.reserveDecimals)} ${market.reserveSymbol}` : "—"}</strong>
            </div>
            {parsedAmount && error && <p className="form-error">{error}</p>}
            <button className="button-primary buy-submit" disabled={!activeQuote || quoting || Boolean(status)} type="submit">
              {status ? <><LoaderCircle className="spin" /> {status}</> : wallet.address ? `${side === "buy" ? "Buy" : "Sell"} ${market.symbol}` : "Connect wallet"}
            </button>
            <details className="trade-price-details">
              <summary>Price details</summary>
              <div><span>Trading fee</span><strong>{side === "buy" ? market.mintRoyaltyBps / 100 : market.burnRoyaltyBps / 100}%</strong></div>
              <div><span>Price protection</span><strong>1%</strong></div>
            </details>
          </form>
        );

  if (embedded) return <section className="buy-panel buy-panel-inline" aria-labelledby="buy-title">{content}</section>;

  return (
    <div className="buy-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="buy-panel" role="dialog" aria-modal="true" aria-labelledby="buy-title">
        <button className="icon-button buy-close" type="button" aria-label="Close" onClick={onClose}><X /></button>
        {content}
      </section>
    </div>
  );
}
