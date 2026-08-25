"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { BOND_ABI, mintclub } from "@mint.club/v2-sdk";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ExternalLink, FileCheck2, ImagePlus, LoaderCircle, X } from "lucide-react";
import { parseEventLogs } from "viem";
import { tokenLogoUrl } from "@/components/token-logo";
import { ChainBadge } from "@/components/chain-badge";
import { LaunchLiquidity } from "@/components/launch-liquidity";
import { useWallet } from "@/components/wallet-provider";
import { CHAINS } from "@/lib/chains";
import { compact, shortAddress, usd } from "@/lib/format";
import {
  DEFAULT_LAUNCH_CURVE_SETTINGS,
  calibrateLaunchCurve,
  type LaunchCurveConfiguration,
} from "@/lib/launch-curve";
import { readManifest, saveManifest } from "@/lib/manifest";
import type { LaunchManifest, TokenAnalysis } from "@/lib/types";

const steps = ["OG token", "Hyped Token", "Pool"];
const internalStepForDisplay = [0, 1, 3] as const;

function displayStep(active: number) {
  if (active >= 3) return 2;
  if (active >= 1) return 1;
  return 0;
}

function stepForStage(stage: LaunchManifest["stage"]) {
  if (stage === "verified") return 4;
  if (stage === "token-created" || stage === "reserve-acquired" || stage === "hyped-minted" || stage === "pool-created") return 3;
  if (stage === "configured") return 1;
  return 1;
}

function stageLabel(stage: LaunchManifest["stage"]) {
  return ({
    analyzed: "OG verified",
    configured: "Pricing ready",
    "token-created": "Hyped Token created",
    "reserve-acquired": "OG ready",
    "hyped-minted": "Liquidity ready",
    "pool-created": "Checking market",
    verified: "Market ready",
  } as const)[stage];
}

function launchUsd(value: number) {
  if (value > 0 && value < 0.00000001) return "<$0.00000001";
  if (value < 0.01) return usd(value, 8);
  return usd(value, 2);
}

function launchTokenAmount(value: number) {
  if (value === 0) return "0";
  if (value < 0.00000001) return value.toExponential(2);
  if (value < 1) return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return compact(value);
}

function walletActionError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  const normalized = message.toLowerCase();
  if (normalized.includes("user rejected") || normalized.includes("user denied") || normalized.includes("rejected the request")) {
    return "Transaction canceled.";
  }
  if (normalized.includes("insufficient funds")) {
    return "Not enough ETH for the creation fee and network fee.";
  }
  if (normalized.includes("no injected wallet") || normalized.includes("connect a wallet")) {
    return "Connect your wallet to create the Hyped Token.";
  }
  if (normalized.includes("chain") && (normalized.includes("switch") || normalized.includes("mismatch") || normalized.includes("unsupported"))) {
    return "Switch your wallet to the selected network and try again.";
  }
  return "The transaction could not be completed. Try again.";
}

type Preflight = {
  creationFeeRaw: string;
  stepCount: number;
  firstRangeRaw: string;
  lastRangeRaw: string;
  firstPriceRaw: string;
  lastPriceRaw: string;
  stepRangesRaw: string[];
  stepPricesRaw: string[];
  blockNumber: string;
  configuration: LaunchCurveConfiguration;
  backingAtFullSupply: string;
  actualReserveUsd: number;
  targetReserveUsd: number;
  marketPrice: NonNullable<TokenAnalysis["marketPrice"]>;
};

type CurveForm = {
  maxSupply: string;
  stepCount: string;
  creatorAllocation: string;
  buyRoyalty: string;
  sellRoyalty: string;
};

type CurvePreview = {
  backingAtFullSupply: string;
  stepCount: number;
  configuration: LaunchCurveConfiguration;
  actualReserveUsd: number;
};

const defaultCurve: CurveForm = {
  maxSupply: String(DEFAULT_LAUNCH_CURVE_SETTINGS.maxSupply),
  stepCount: String(DEFAULT_LAUNCH_CURVE_SETTINGS.stepCount),
  creatorAllocation: String(DEFAULT_LAUNCH_CURVE_SETTINGS.creatorAllocation),
  buyRoyalty: String(DEFAULT_LAUNCH_CURVE_SETTINGS.buyRoyalty),
  sellRoyalty: String(DEFAULT_LAUNCH_CURVE_SETTINGS.sellRoyalty),
};

function settingsFrom(form: CurveForm) {
  return {
    maxSupply: Number(form.maxSupply),
    stepCount: Number(form.stepCount),
    creatorAllocation: Number(form.creatorAllocation),
    buyRoyalty: Number(form.buyRoyalty),
    sellRoyalty: Number(form.sellRoyalty),
  };
}

function previewCurve(form: CurveForm, manifest: LaunchManifest): CurvePreview | null {
  try {
    const marketPrice = manifest.analysis.marketPrice?.usd;
    if (!marketPrice) return null;
    const calibrated = calibrateLaunchCurve({
      reserveToken: {
        address: manifest.analysis.tokenAddress,
        decimals: manifest.analysis.decimals,
      },
      reservePriceUsd: marketPrice,
      reserveTotalSupply: Number(manifest.analysis.totalSupplyFormatted),
      settings: settingsFrom(form),
    });
    return {
      backingAtFullSupply: calibrated.backing.backingFormatted,
      stepCount: calibrated.backing.stepCount,
      configuration: calibrated.configuration,
      actualReserveUsd: calibrated.actualReserveUsd,
    };
  } catch {
    return null;
  }
}

export function LaunchWorkspace() {
  const params = useParams<{ id: string }>();
  const wallet = useWallet();
  const [manifest, setManifest] = useState<LaunchManifest | null>(null);
  const [active, setActive] = useState(1);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [form, setForm] = useState<CurveForm>(defaultCurve);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [metadataNotice, setMetadataNotice] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const item = readManifest(params.id);
    if (!item) return;
    const legacyName = `Hyped ${item.analysis.name}`;
    const suggestedName = item.stage === "analyzed" && item.input.hypedName === legacyName
      ? `Hyped ${item.analysis.symbol}`
      : item.input.hypedName;
    // Restoring the browser recovery record is this effect's external-system boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManifest(item);
    setName(suggestedName);
    setSymbol(item.input.hypedSymbol);
    if (item.configuration) {
      setForm({
        maxSupply: String(item.configuration.maxSupply),
        stepCount: String(item.configuration.stepCount),
        creatorAllocation: String(item.configuration.creatorAllocation),
        buyRoyalty: String(item.configuration.buyRoyalty),
        sellRoyalty: String(item.configuration.sellRoyalty),
      });
      setActive(stepForStage(item.stage));
    }
  }, [params.id]);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  const chain = manifest ? CHAINS[manifest.chain] : null;
  const settings = useMemo(() => settingsFrom(form), [form]);
  const curvePreview = useMemo(() => manifest ? previewCurve(form, manifest) : null, [form, manifest]);

  function changeField(key: keyof CurveForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setPreflight(null);
    setError("");
  }

  function chooseLogo(file: File | null) {
    setMetadataNotice("");
    if (!file) {
      setLogo(null);
      setLogoPreview(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a PNG, JPG or WebP logo.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Keep the token logo under 2 MB.");
      return;
    }
    setError("");
    setLogo(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function validateCurve(event?: FormEvent): Promise<{ manifest: LaunchManifest; preflight: Preflight } | null> {
    event?.preventDefault();
    if (!manifest) return null;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/launch/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chain: manifest.chain,
          symbol,
          name,
          reserveToken: manifest.analysis.tokenAddress,
          reserveDecimals: manifest.analysis.decimals,
          ...settings,
        }),
      });
      const payload = await response.json() as { preflight?: Preflight; error?: string };
      if (!response.ok || !payload.preflight) throw new Error(payload.error ?? "Mint Club preflight failed.");
      const updated = saveManifest({
        ...manifest,
        stage: "configured",
        input: { ...manifest.input, hypedName: name.trim(), hypedSymbol: symbol.trim() },
        analysis: { ...manifest.analysis, marketPrice: payload.preflight.marketPrice },
        configuration: payload.preflight.configuration,
        provenance: { ...manifest.provenance, quoteExpiresAt: null },
      });
      setManifest(updated);
      setPreflight(payload.preflight);
      return { manifest: updated, preflight: payload.preflight };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mint Club preflight failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createBond(configuredManifest = manifest, reviewedPreflight = preflight) {
    if (!configuredManifest?.configuration || !reviewedPreflight) return;
    setBusy(true);
    setError("");
    try {
      const walletClient = await wallet.getWalletClient(configuredManifest.chain);
      const publicClient = await wallet.getPublicClient(configuredManifest.chain);
      const account = walletClient.account?.address;
      if (!account) throw new Error("Connect a wallet to continue.");
      mintclub.withPublicClient(publicClient).withWalletClient(walletClient);
      const token = mintclub.network(configuredManifest.chain).token(configuredManifest.input.hypedSymbol);
      const createParams = {
        name: configuredManifest.input.hypedName,
        reserveToken: {
          address: configuredManifest.analysis.tokenAddress,
          decimals: configuredManifest.analysis.decimals,
        },
        curveData: {
          curveType: "EXPONENTIAL" as const,
          stepCount: configuredManifest.configuration.stepCount,
          maxSupply: configuredManifest.configuration.maxSupply,
          initialMintingPrice: configuredManifest.configuration.initialMintingPrice,
          finalMintingPrice: configuredManifest.configuration.finalMintingPrice,
          creatorAllocation: configuredManifest.configuration.creatorAllocation,
        },
        buyRoyalty: configuredManifest.configuration.buyRoyalty,
        sellRoyalty: configuredManifest.configuration.sellRoyalty,
      };
      const prepared = await token.checkAndPrepareCreateArgs(createParams);
      if (prepared.fee.toString() !== reviewedPreflight.creationFeeRaw) {
        throw new Error("The Mint Club creation fee changed. Run preflight again before signing.");
      }
      const reviewedRanges = prepared.args.bondParams.stepRanges.map((value) => value.toString());
      const reviewedPrices = prepared.args.bondParams.stepPrices.map((value) => value.toString());
      if (
        reviewedRanges.length !== reviewedPreflight.stepRangesRaw.length
        || reviewedPrices.length !== reviewedPreflight.stepPricesRaw.length
        || reviewedRanges.some((value, index) => value !== reviewedPreflight.stepRangesRaw[index])
        || reviewedPrices.some((value, index) => value !== reviewedPreflight.stepPricesRaw[index])
      ) {
        throw new Error("The Mint Club curve changed after review. Review the pool setup again before signing.");
      }
      const simulation = await publicClient.simulateContract({
        address: CHAINS[configuredManifest.chain].mintClubBond,
        abi: BOND_ABI,
        functionName: "createToken",
        args: [prepared.args.tokenParams, prepared.args.bondParams],
        account,
        value: prepared.fee,
      });
      const transactionHash = await walletClient.writeContract(simulation.request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
      if (receipt.status !== "success") throw new Error("The Mint Club creation transaction did not confirm.");
      const events = parseEventLogs({ abi: BOND_ABI, logs: receipt.logs, eventName: "TokenCreated" });
      const created = events.find((event) => event.eventName === "TokenCreated");
      if (!created) throw new Error("The transaction confirmed without a TokenCreated event.");
      const updated = saveManifest({
        ...configuredManifest,
        owner: account,
        stage: "token-created",
        execution: {
          ...configuredManifest.execution,
          hypedToken: created.args.token,
          txs: { ...configuredManifest.execution.txs, "token-created": receipt.transactionHash },
        },
      });
      setManifest(updated);
      if (logo) {
        try {
          await mintclub.network(configuredManifest.chain).token(created.args.token).createMintClubMetadata({ logo });
          setMetadataNotice("Logo saved to Mint Club.");
        } catch {
          setMetadataNotice("The Hyped Token was created, but Mint Club did not accept the logo.");
        }
      }
      setActive(2);
    } catch (reason) {
      setError(walletActionError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function launchToken(event: FormEvent) {
    const reviewed = await validateCurve(event);
    if (!reviewed) return;
    await createBond(reviewed.manifest, reviewed.preflight);
  }

  if (!manifest || !chain) {
    return <div className="empty-state page-shell"><h1>Pool setup not found.</h1><p>Choose an OG token to begin.</p><Link className="primary-link" href="/launch">Start over</Link></div>;
  }

  return (
    <div className="workspace page-shell">
      <div className="workspace-head"><Link href="/launch" className="back-link"><ArrowLeft /> Choose another token</Link></div>
      <div className="launch-title">
        <div><h1>Create a pool with {manifest.analysis.symbol}</h1><p><ChainBadge chain={manifest.chain} className="inline" /> {chain.shortName} · Verified onchain</p></div>
        <a className="secondary-link" href={`${chain.explorerUrl}/token/${manifest.analysis.tokenAddress}`} target="_blank" rel="noreferrer">OG contract <ExternalLink /></a>
      </div>
      <ol className="stepper launch-stepper">
        {steps.map((step, index) => {
          const current = displayStep(active);
          return <li className={index === current ? "active" : index < current ? "done" : ""} key={step}><button onClick={() => index < current && setActive(internalStepForDisplay[index])} type="button"><span>{index < current ? <Check /> : index + 1}</span><b>{step}</b></button></li>;
        })}
      </ol>
      <div className="workspace-grid">
        <section className="workspace-main">
          {active === 0 && <AnalysisPanel manifest={manifest} onNext={() => setActive(1)} />}
          {active === 1 && (
            <form className="panel form-panel" onSubmit={launchToken}>
              <div className="panel-heading"><div><span className="kicker">Token details</span><h2>Create your Hyped Token.</h2></div></div>
              <div className="field-row"><label>Name<input required minLength={2} maxLength={32} value={name} onChange={(event) => { setName(event.target.value); setPreflight(null); setError(""); }} /></label><label>Symbol<input required minLength={2} maxLength={12} value={symbol} onChange={(event) => { setSymbol(event.target.value.replace(/[^A-Za-z0-9]/g, "")); setPreflight(null); setError(""); }} /></label></div>
              <div className="launch-logo-field">
                <span>Logo</span>
                <label>
                  <input accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseLogo(event.target.files?.[0] ?? null)} type="file" />
                  <ImagePlus />
                  <strong>{logo?.name ?? "Choose image"}</strong>
                  <small>Saved directly to Mint Club · 2 MB max</small>
                </label>
              </div>
              <button className="advanced-settings-trigger" onClick={() => setAdvancedOpen(true)} type="button">Advanced settings <ArrowRight /></button>
              {advancedOpen && <div className="settings-modal-backdrop" onMouseDown={() => setAdvancedOpen(false)} role="presentation">
                <section aria-labelledby="advanced-settings-title" aria-modal="true" className="settings-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
                  <div className="settings-modal-head"><div><span className="kicker">Optional</span><h2 id="advanced-settings-title">Advanced settings</h2></div><button aria-label="Close advanced settings" onClick={() => setAdvancedOpen(false)} type="button"><X /></button></div>
                  <div className="curve-form-grid">
                    <NumberField label="Supply" value={form.maxSupply} onChange={(value) => changeField("maxSupply", value)} />
                    <NumberField label="Price steps" value={form.stepCount} onChange={(value) => changeField("stepCount", value)} min="2" max="1000" step="1" />
                    <NumberField label="Creator allocation" value={form.creatorAllocation} onChange={(value) => changeField("creatorAllocation", value)} min="0" />
                    <NumberField label="Buy fee · %" value={form.buyRoyalty} onChange={(value) => changeField("buyRoyalty", value)} min="0" max="10" />
                    <NumberField label="Return fee · %" value={form.sellRoyalty} onChange={(value) => changeField("sellRoyalty", value)} min="0" max="10" />
                  </div>
                  <div className="settings-modal-actions"><button className="button-primary" onClick={() => setAdvancedOpen(false)} type="button">Done</button></div>
                </section>
              </div>}
              {manifest.analysis.riskStatus === "blocked" && <p className="form-error">{manifest.analysis.riskReasons[0]}</p>}
              {!curvePreview && !error && <p className="form-error">A verified USD price and sufficient OG supply are required for this pool.</p>}
              {error && <p className="form-error">{error}</p>}
              <div className="panel-actions"><button className="button-ghost" onClick={() => setActive(0)} type="button">Back</button><button className="button-primary" disabled={busy || !curvePreview || manifest.analysis.riskStatus === "blocked"}>{busy ? <LoaderCircle className="spin" /> : <>Create Hyped Token <ArrowRight /></>}</button></div>
            </form>
          )}
          {active === 2 && <CreatedPanel manifest={manifest} metadataNotice={metadataNotice} onContinue={() => setActive(3)} />}
          {(active === 3 || active === 4) && <LaunchLiquidity manifest={manifest} onChange={setManifest} onComplete={() => setActive(4)} />}
        </section>
        <aside className="workspace-aside"><LaunchSummary manifest={manifest} preflight={preflight} name={name} symbol={symbol} form={form} preview={curvePreview} logoPreview={logoPreview} /></aside>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, min = "0.000000000000000001", max, step = "any" }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string; step?: string }) {
  return <label>{label}<input required type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function AnalysisPanel({ manifest, onNext }: { manifest: LaunchManifest; onNext: () => void }) {
  const analysis = manifest.analysis;
  const chainId = CHAINS[manifest.chain].id;
  return <div className="panel"><div className="panel-heading"><div><span className="kicker">OG token</span><h2>OG token verified.</h2></div><FileCheck2 /></div><div className="asset-card"><span className="token-chain-logo"><Image src={tokenLogoUrl(analysis.tokenAddress, chainId)} alt="" width={44} height={44} unoptimized /><ChainBadge chain={manifest.chain} /></span><div><h3>{analysis.name} <span>{analysis.symbol}</span></h3><code>{analysis.tokenAddress}</code></div></div><details className="launch-advanced"><summary>Onchain details</summary><div className="detail-list">{analysis.marketPrice && <div><span>Market price</span><strong>{launchUsd(analysis.marketPrice.usd)}</strong></div>}<div><span>Precision</span><strong>{analysis.decimals} decimals</strong></div><div><span>Total supply</span><strong>{compact(Number(analysis.totalSupplyFormatted))} {analysis.symbol}</strong></div><div><span>Network</span><strong>{CHAINS[manifest.chain].name}</strong></div><div><span>Read block</span><strong>#{analysis.blockNumber}</strong></div></div></details><div className="panel-actions"><span /><button className="button-primary" onClick={onNext} type="button">Create Hyped Token <ArrowRight /></button></div></div>;
}

function CreatedPanel({ manifest, metadataNotice, onContinue }: { manifest: LaunchManifest; metadataNotice: string; onContinue: () => void }) {
  const chain = CHAINS[manifest.chain];
  if (!manifest.execution.hypedToken) return null;
  return <div className="panel confirmed-panel"><CheckCircle2 /><span className="kicker">Transaction confirmed</span><h2>{manifest.input.hypedSymbol} created.</h2><p>The Hyped Token is live in Mint Club. Continue to add liquidity and create its connected pool.</p>{metadataNotice && <p className="metadata-notice">{metadataNotice}</p>}<div className="confirmed-address"><span>Hyped Token</span><code>{manifest.execution.hypedToken}</code></div><div className="panel-actions"><a className="button-ghost" href={`${chain.explorerUrl}/token/${manifest.execution.hypedToken}`} target="_blank" rel="noreferrer">View explorer <ExternalLink /></a><button className="button-primary" onClick={onContinue} type="button">Continue to pool <ArrowRight /></button></div></div>;
}

function LaunchSummary({ manifest, preflight, name, symbol, form, preview, logoPreview }: { manifest: LaunchManifest; preflight: Preflight | null; name: string; symbol: string; form: CurveForm; preview: CurvePreview | null; logoPreview: string | null }) {
  const previewState = manifest.execution.hypedToken ? stageLabel(manifest.stage) : "Live";
  const marketPrice = manifest.analysis.marketPrice?.usd ?? null;
  const configuration = preflight?.configuration ?? preview?.configuration ?? manifest.configuration;
  const backingAtFullSupply = preflight?.backingAtFullSupply ?? preview?.backingAtFullSupply;
  const maxReserveUsd = preflight?.actualReserveUsd ?? preview?.actualReserveUsd ?? null;
  const startUsd = configuration && marketPrice !== null ? configuration.initialMintingPrice * marketPrice : null;
  const endUsd = configuration && marketPrice !== null ? configuration.finalMintingPrice * marketPrice : null;
  return (
    <div className="summary-card">
      <div className="summary-head"><span>Your Hyped Token</span><b>{previewState}</b></div>
      <div className="summary-asset">
        <span className="summary-logo">{logoPreview ? <Image alt="Selected Hyped Token logo preview" height={44} src={logoPreview} unoptimized width={44} /> : <ImagePlus aria-label="No logo selected" />}</span>
        <span><strong>{name || "Untitled Hyped Token"}</strong><small>{symbol || "Hyped Token"} backed by {manifest.analysis.symbol}</small></span>
      </div>
      <dl>
        <div><dt>Network</dt><dd>{CHAINS[manifest.chain].shortName}</dd></div>
        <div><dt>OG token</dt><dd>{manifest.analysis.symbol}</dd></div>
        {marketPrice !== null && <div><dt>OG price</dt><dd>{launchUsd(marketPrice)}</dd></div>}
        {configuration && <div className="summary-key-value"><dt>Price range</dt><dd>{startUsd !== null && endUsd !== null && <strong>≈ {launchUsd(startUsd)} – {launchUsd(endUsd)}</strong>}<small>{launchTokenAmount(configuration.initialMintingPrice)} – {launchTokenAmount(configuration.finalMintingPrice)} {manifest.analysis.symbol}</small></dd></div>}
        {backingAtFullSupply && <div className="summary-key-value"><dt>Max reserve</dt><dd>{maxReserveUsd !== null && <strong>≈ {usd(maxReserveUsd, 0)}</strong>}<small>{compact(Number(backingAtFullSupply))} {manifest.analysis.symbol}</small></dd></div>}
        <div><dt>Fees</dt><dd>{form.buyRoyalty}% buy · {form.sellRoyalty}% return</dd></div>
        {manifest.execution.hypedToken && <div><dt>Hyped Token</dt><dd>{shortAddress(manifest.execution.hypedToken)}</dd></div>}
      </dl>
    </div>
  );
}
