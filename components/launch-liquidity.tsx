"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BOND_ABI,
} from "@mint.club/v2-sdk";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import {
  erc20Abi,
  formatUnits,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { useWallet } from "@/components/wallet-provider";
import { CHAINS } from "@/lib/chains";
import { saveManifest } from "@/lib/manifest";
import type { ArbitragePreview, LaunchManifest, LiquidityPreparation } from "@/lib/types";

const WETH_ABI = parseAbi([
  "function deposit() payable",
]);

const POSITION_EVENTS = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);

type MarketResponse = {
  markets?: { pool: { address: Address; liquidityRaw: string } | null }[];
  error?: string;
};

async function waitForSuccess(publicClient: PublicClient, hash: `0x${string}`, message: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(message);
  return receipt;
}

async function approveExact({
  publicClient,
  walletClient,
  token,
  owner,
  spender,
  amount,
}: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  token: Address;
  owner: Address;
  spender: Address;
  amount: bigint;
}) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= amount) return;

  async function writeApproval(nextAmount: bigint) {
    const simulation = await publicClient.simulateContract({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, nextAmount],
      account: owner,
    });
    const hash = await walletClient.writeContract(simulation.request);
    await waitForSuccess(publicClient, hash, "The token approval did not confirm.");
  }

  try {
    await writeApproval(amount);
  } catch (reason) {
    if (allowance === 0n) throw reason;
    await writeApproval(0n);
    await writeApproval(amount);
  }
}

async function requestPreparation(
  manifest: LaunchManifest,
  owner: Address,
  hypedAmountRaw: string,
  reserveReferenceRaw?: string,
) {
  if (!manifest.execution.hypedToken) throw new Error("Create the Hyped Token first.");
  const response = await fetch("/api/launch/liquidity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chain: manifest.chain,
      owner,
      hypedToken: manifest.execution.hypedToken,
      hypedAmountRaw,
      reserveReferenceRaw,
    }),
  });
  const payload = await response.json() as { preparation?: LiquidityPreparation; error?: string };
  if (!response.ok || !payload.preparation) {
    throw new Error(payload.error ?? "The connected-market check failed.");
  }
  return payload.preparation;
}

export function LaunchLiquidity({
  manifest,
  onChange,
  onComplete,
}: {
  manifest: LaunchManifest;
  onChange: (manifest: LaunchManifest) => void;
  onComplete: () => void;
}) {
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [hypedDecimals, setHypedDecimals] = useState(18);
  const [preparation, setPreparation] = useState<LiquidityPreparation | null>(null);
  const [busy, setBusy] = useState<"preview" | "mint" | "pool" | "verify" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!manifest.execution.hypedToken) return;
    void wallet.getPublicClient(manifest.chain).then(async (client) => {
      const decimals = await client.readContract({
        address: manifest.execution.hypedToken!,
        abi: erc20Abi,
        functionName: "decimals",
      });
      setHypedDecimals(decimals);
      if (manifest.liquidity?.hypedAmountRaw) {
        setAmount(formatUnits(BigInt(manifest.liquidity.hypedAmountRaw), decimals));
      }
    }).catch(() => undefined);
  }, [manifest.chain, manifest.execution.hypedToken, manifest.liquidity?.hypedAmountRaw, wallet]);

  async function ownerAndAmount() {
    const walletClient = await wallet.getWalletClient(manifest.chain);
    const owner = walletClient.account?.address;
    if (!owner) throw new Error("Connect a wallet to continue.");
    if (manifest.owner && !isAddressEqual(manifest.owner, owner)) {
      throw new Error("Use the wallet that created this Hyped Token.");
    }
    const raw = parseUnits(amount, hypedDecimals);
    if (raw <= 0n) throw new Error("Enter a Hyped Token amount greater than zero.");
    return { owner, raw, walletClient };
  }

  async function preview() {
    setBusy("preview");
    setError("");
    try {
      const { owner, raw } = await ownerAndAmount();
      const next = await requestPreparation(manifest, owner, raw.toString());
      setPreparation(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The connected-market check failed.");
    } finally {
      setBusy(null);
    }
  }

  async function mintLiquidityTokens() {
    if (!preparation || !manifest.execution.hypedToken) return;
    setBusy("mint");
    setError("");
    try {
      const { owner, walletClient } = await ownerAndAmount();
      const publicClient = await wallet.getPublicClient(manifest.chain);
      const reserveBalance = await publicClient.readContract({
        address: preparation.reserveToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      });
      const maxReserve = BigInt(preparation.maxReserveAmountRaw);
      if (reserveBalance < maxReserve) {
        throw new Error(
          `This mint can use up to ${formatUnits(maxReserve, preparation.reserveDecimals)} ${preparation.reserveSymbol}. The connected wallet does not have enough.`,
        );
      }
      await approveExact({
        publicClient,
        walletClient,
        token: preparation.reserveToken,
        owner,
        spender: CHAINS[manifest.chain].mintClubBond,
        amount: maxReserve,
      });
      const simulation = await publicClient.simulateContract({
        address: CHAINS[manifest.chain].mintClubBond,
        abi: BOND_ABI,
        functionName: "mint",
        args: [
          manifest.execution.hypedToken,
          BigInt(preparation.hypedAmountRaw),
          maxReserve,
          owner,
        ],
        account: owner,
      });
      const hash = await walletClient.writeContract(simulation.request);
      const receipt = await waitForSuccess(publicClient, hash, "The Mint Club mint did not confirm.");
      const events = parseEventLogs({
        abi: BOND_ABI,
        logs: receipt.logs,
        eventName: "Mint",
      });
      const mintEvent = events.find((event) =>
        event.eventName === "Mint" &&
        isAddressEqual(event.args.token, manifest.execution.hypedToken!) &&
        isAddressEqual(event.args.user, owner),
      );
      if (!mintEvent) throw new Error("The transaction confirmed without the expected Mint event.");
      const reserveSpentRaw = mintEvent.args.reserveAmount.toString();
      const updated = saveManifest({
        ...manifest,
        owner,
        stage: "hyped-minted",
        liquidity: {
          hypedAmountRaw: preparation.hypedAmountRaw,
          reserveSpentRaw,
          quoteToken: preparation.quoteToken,
          quoteSymbol: preparation.quoteSymbol,
          quoteDecimals: preparation.quoteDecimals,
          quoteAmountRaw: preparation.quoteAmountRaw,
          fee: preparation.poolFee,
        },
        execution: {
          ...manifest.execution,
          txs: { ...manifest.execution.txs, "hyped-minted": receipt.transactionHash },
        },
      });
      onChange(updated);
      const refreshed = await requestPreparation(
        updated,
        owner,
        preparation.hypedAmountRaw,
        reserveSpentRaw,
      );
      setPreparation(refreshed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Mint Club mint failed.");
    } finally {
      setBusy(null);
    }
  }

  async function createPool() {
    if (!manifest.execution.hypedToken || !manifest.liquidity) return;
    setBusy("pool");
    setError("");
    try {
      const { owner, walletClient } = await ownerAndAmount();
      const publicClient = await wallet.getPublicClient(manifest.chain);
      const fresh = await requestPreparation(
        manifest,
        owner,
        manifest.liquidity.hypedAmountRaw,
        manifest.liquidity.reserveSpentRaw,
      );
      setPreparation(fresh);
      const hypedRequired = BigInt(fresh.positionAmountHypedRaw);
      const quoteRequired = BigInt(fresh.positionAmountQuoteRaw);
      const [hypedBalance, initialQuoteBalance] = await Promise.all([
        publicClient.readContract({
          address: manifest.execution.hypedToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        }),
        publicClient.readContract({
          address: fresh.quoteToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        }),
      ]);
      if (hypedBalance < hypedRequired) {
        throw new Error(`The wallet needs ${formatUnits(hypedRequired, fresh.hypedDecimals)} ${fresh.hypedSymbol} for initial liquidity.`);
      }
      let quoteBalance = initialQuoteBalance;
      if (quoteBalance < quoteRequired && isAddressEqual(fresh.quoteToken, CHAINS[manifest.chain].weth)) {
        const shortfall = quoteRequired - quoteBalance;
        const nativeBalance = await publicClient.getBalance({ address: owner });
        if (nativeBalance <= shortfall) {
          throw new Error(`The wallet needs ${formatUnits(shortfall, fresh.quoteDecimals)} ETH plus gas to prepare ${fresh.quoteSymbol}.`);
        }
        const wrapSimulation = await publicClient.simulateContract({
          address: fresh.quoteToken,
          abi: WETH_ABI,
          functionName: "deposit",
          account: owner,
          value: shortfall,
        });
        const wrapHash = await walletClient.writeContract(wrapSimulation.request);
        await waitForSuccess(publicClient, wrapHash, "Wrapping ETH did not confirm.");
        quoteBalance += shortfall;
      }
      if (quoteBalance < quoteRequired) {
        throw new Error(`The wallet needs ${formatUnits(quoteRequired, fresh.quoteDecimals)} ${fresh.quoteSymbol} for initial liquidity.`);
      }
      await approveExact({
        publicClient,
        walletClient,
        token: manifest.execution.hypedToken,
        owner,
        spender: fresh.positionManager,
        amount: hypedRequired,
      });
      await approveExact({
        publicClient,
        walletClient,
        token: fresh.quoteToken,
        owner,
        spender: fresh.positionManager,
        amount: quoteRequired,
      });
      await publicClient.call({
        account: owner,
        to: fresh.positionManager,
        data: fresh.calldata,
        value: BigInt(fresh.valueRaw),
      });
      const hash = await walletClient.sendTransaction({
        account: owner,
        chain: walletClient.chain,
        to: fresh.positionManager,
        data: fresh.calldata,
        value: BigInt(fresh.valueRaw),
      });
      const receipt = await waitForSuccess(publicClient, hash, "The Uniswap position did not confirm.");
      const transfers = parseEventLogs({ abi: POSITION_EVENTS, logs: receipt.logs, eventName: "Transfer" });
      const position = transfers.find((event) =>
        isAddressEqual(event.address, fresh.positionManager) &&
        isAddressEqual(event.args.from, zeroAddress) &&
        isAddressEqual(event.args.to, owner),
      );
      const updated = saveManifest({
        ...manifest,
        stage: "pool-created",
        liquidity: {
          ...manifest.liquidity,
          quoteToken: fresh.quoteToken,
          quoteSymbol: fresh.quoteSymbol,
          quoteDecimals: fresh.quoteDecimals,
          quoteAmountRaw: fresh.positionAmountQuoteRaw,
          fee: fresh.poolFee,
        },
        execution: {
          ...manifest.execution,
          pool: fresh.pool,
          lpTokenId: position?.args.tokenId.toString() ?? null,
          txs: { ...manifest.execution.txs, "pool-created": receipt.transactionHash },
        },
      });
      onChange(updated);
      await verify(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Uniswap pool transaction failed.");
    } finally {
      setBusy(null);
    }
  }

  async function verify(current = manifest) {
    if (!current.execution.hypedToken || !current.execution.pool) return;
    setBusy("verify");
    setError("");
    try {
      const response = await fetch(`/api/market?chain=${current.chain}&address=${current.execution.hypedToken}`, { cache: "no-store" });
      const payload = await response.json() as MarketResponse;
      const verified = payload.markets?.find((market) =>
        market.pool &&
        isAddressEqual(market.pool.address, current.execution.pool!) &&
        BigInt(market.pool.liquidityRaw) > 0n,
      );
      if (!response.ok || !verified) {
        throw new Error(payload.error ?? "The pool is confirmed but active liquidity is not visible yet. Recheck after the next block.");
      }
      const updated = saveManifest({ ...current, stage: "verified" });
      onChange(updated);
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The market verification failed.");
    } finally {
      setBusy(null);
    }
  }

  if (manifest.stage === "verified" && manifest.execution.hypedToken) {
    return <LaunchVerified manifest={manifest} />;
  }

  if (manifest.stage === "pool-created") {
    return (
      <div className="panel confirmed-panel">
        <ShieldCheck />
        <span className="kicker">Pool transaction confirmed</span>
        <h2>Verify active liquidity.</h2>
        <p>The final check reads the Hyped Token pool and its live liquidity directly from Base.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="panel-actions"><span /><button className="button-primary" disabled={busy !== null} onClick={() => void verify()} type="button">{busy === "verify" ? <LoaderCircle className="spin" /> : "Verify market"}</button></div>
      </div>
    );
  }

  const minted = manifest.stage === "hyped-minted" && manifest.liquidity;
  return (
    <div className="panel form-panel liquidity-panel">
      <div className="panel-heading"><div><span className="kicker">Pool setup</span><h2>Create the Hyped Token pool.</h2></div></div>
      <p className="panel-copy">Create a backed amount first. The same real value sets the opening pool price.</p>
      <label className="liquidity-amount">Hyped Token for initial liquidity<input disabled={Boolean(minted)} type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setPreparation(null); setError(""); }} placeholder="0" /></label>
      {!minted && <button className="button-ghost liquidity-check" disabled={!amount || busy !== null} onClick={() => void preview()} type="button">{busy === "preview" ? <LoaderCircle className="spin" /> : "Check real requirements"}</button>}
      {preparation && (
        <div className="liquidity-route">
          <div><span>Backed mint</span><strong>{formatUnits(BigInt(preparation.reserveRequiredRaw), preparation.reserveDecimals)} {preparation.reserveSymbol}</strong></div>
          <i>→</i>
          <div><span>Opening market</span><strong>{formatUnits(BigInt(preparation.positionAmountQuoteRaw), preparation.quoteDecimals)} {preparation.quoteSymbol}</strong></div>
          <i>→</i>
          <div><span>LP owner</span><strong>Your wallet</strong></div>
        </div>
      )}
      <div className="alert info"><ShieldCheck /><div><strong>Wallet-owned position</strong><p>Each approval and transaction is shown by your wallet. The Uniswap position NFT is sent directly to the connected wallet.</p></div></div>
      {error && <p className="form-error">{error}</p>}
      <div className="panel-actions">
        <span>{preparation ? `Read at Base block #${preparation.readBlock}` : "No pool is created until you sign."}</span>
        {!minted ? <button className="button-primary" disabled={!preparation || busy !== null} onClick={() => void mintLiquidityTokens()} type="button">{busy === "mint" ? <LoaderCircle className="spin" /> : `Create ${manifest.input.hypedSymbol}`}</button> : <button className="button-primary" disabled={busy !== null} onClick={() => void createPool()} type="button">{busy === "pool" ? <LoaderCircle className="spin" /> : "Create the pool"}</button>}
      </div>
    </div>
  );
}

function LaunchVerified({ manifest }: { manifest: LaunchManifest }) {
  const chain = CHAINS[manifest.chain];
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [decimals, setDecimals] = useState(18);
  const [preview, setPreview] = useState<ArbitragePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function check(raw?: string) {
    if (!manifest.execution.hypedToken) return;
    setBusy(true);
    setError("");
    try {
      const hypedAmountRaw = raw ?? parseUnits(amount, decimals).toString();
      const response = await fetch("/api/launch/arbitrage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain: manifest.chain, hypedToken: manifest.execution.hypedToken, hypedAmountRaw }),
      });
      const payload = await response.json() as { preview?: ArbitragePreview; error?: string };
      if (!response.ok || !payload.preview) throw new Error(payload.error ?? "The route preview failed.");
      setPreview(payload.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The route preview failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!manifest.execution.hypedToken || !manifest.liquidity?.hypedAmountRaw) return;
    const raw = manifest.liquidity.hypedAmountRaw;
    void wallet.getPublicClient(manifest.chain).then(async (client) => {
      const tokenDecimals = await client.readContract({
        address: manifest.execution.hypedToken!,
        abi: erc20Abi,
        functionName: "decimals",
      });
      setDecimals(tokenDecimals);
      setAmount(formatUnits(BigInt(raw), tokenDecimals));
      await check(raw);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "The route preview failed."));
    // The seeded onchain amount is the one-time initial route check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.chain, manifest.execution.hypedToken, manifest.liquidity?.hypedAmountRaw]);

  return <div className="panel confirmed-panel route-verified"><CheckCircle2 /><span className="kicker">Pool verified</span><h2>The arbitrage loop is ready.</h2><p>The OG market, Mint Club conversion, and Hyped Token pool are readable onchain. A price difference may open a route; profit is never guaranteed.</p><div className="route-check-form"><label>Compare with<input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /><span>{manifest.input.hypedSymbol}</span></label><button className="button-ghost" disabled={busy || !amount} onClick={() => void check()} type="button">{busy ? <LoaderCircle className="spin" /> : "Refresh routes"}</button></div>{preview && <div className="route-results"><RouteResult label={`Mint ${preview.hypedSymbol}, then sell`} route={preview.mintRoute} preview={preview} /><RouteResult label={`Buy ${preview.hypedSymbol}, then redeem`} route={preview.redeemRoute} preview={preview} /></div>}<p className="route-method">Live executable quotes · Uniswap and Mint Club fees included · Gas excluded · Read at block #{preview?.readBlock ?? "—"}</p>{error && <p className="form-error">{error}</p>}<div className="verified-links"><a className="button-ghost" href={`${chain.explorerUrl}/address/${manifest.execution.pool}`} target="_blank" rel="noreferrer">Pool contract <ExternalLink /></a><Link className="button-primary" href={`/market/${manifest.chain}/${manifest.execution.hypedToken}`}>Open market</Link></div></div>;
}

function RouteResult({ label, route, preview }: { label: string; route: ArbitragePreview["mintRoute"]; preview: ArbitragePreview }) {
  const difference = BigInt(route.differenceRaw);
  return <div className={route.profitableBeforeGas ? "route-open" : ""}><span>{label}</span><strong>{formatUnits(BigInt(route.quoteInRaw), preview.quoteDecimals)} → {formatUnits(BigInt(route.quoteOutRaw), preview.quoteDecimals)} {preview.quoteSymbol}</strong><small>{route.profitableBeforeGas ? `+${formatUnits(difference, preview.quoteDecimals)} before gas` : `${formatUnits(difference, preview.quoteDecimals)} before gas`}</small></div>;
}
