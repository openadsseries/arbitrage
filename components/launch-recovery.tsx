"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ArrowRight, RotateCcw, Trash2 } from "lucide-react";
import { ChainBadge } from "@/components/chain-badge";
import { tokenLogoUrl } from "@/components/token-logo";
import { relativeTime } from "@/lib/format";
import { deleteManifest, readManifests } from "@/lib/manifest";
import type { LaunchManifest } from "@/lib/types";

function unfinishedManifests() {
  return readManifests()
    .filter((item) => item.stage !== "verified")
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function stageLabel(stage: LaunchManifest["stage"]) {
  return stage.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function LaunchRecovery() {
  const [items, setItems] = useState<LaunchManifest[]>([]);
  const [visible, setVisible] = useState(6);

  useEffect(() => {
    // Recovery records are browser-owned form state, not a source of onchain truth.
    const refresh = () => setItems(unfinishedManifests());
    refresh();
    window.addEventListener("hyped:manifest-updated", refresh);
    return () => window.removeEventListener("hyped:manifest-updated", refresh);
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="launch-recovery" aria-labelledby="recovery-title">
      <div>
        <span className="kicker">Recovery</span>
        <h2 id="recovery-title">Resume an unfinished pool setup.</h2>
        <p>These entries restore form inputs only. Contract state is checked again before signing.</p>
      </div>
      <div className="recovery-list">
        {items.slice(0, visible).map((item) => (
          <article key={item.id}>
            <Link href={`/launch/${item.id}`}>
              <span className="recovery-token">
                <span className="token-chain-logo">
                  <Image src={tokenLogoUrl(item.input.backingToken, item.analysis.chainId)} alt="" width={34} height={34} unoptimized />
                  <ChainBadge chain={item.chain} />
                </span>
                <span><strong>{item.input.hypedSymbol}</strong><small>{item.analysis.symbol} reserve</small></span>
              </span>
              <span className="recovery-status">{relativeTime(item.updatedAt)}<small>{stageLabel(item.stage)}</small></span>
              <span className="recovery-continue"><RotateCcw /><ArrowRight /></span>
            </Link>
            <button aria-label={`Delete ${item.input.hypedSymbol} recovery entry`} onClick={() => deleteManifest(item.id)} type="button"><Trash2 /></button>
          </article>
        ))}
        {items.length > visible && (
          <button className="recovery-more" onClick={() => setVisible((value) => value + 6)} type="button">
            Show more
          </button>
        )}
      </div>
    </section>
  );
}
