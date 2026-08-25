"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { ChainBadge } from "@/components/chain-badge";
import { relativeTime } from "@/lib/format";
import { readManifests } from "@/lib/manifest";
import type { LaunchManifest } from "@/lib/types";

export function LaunchRecovery() {
  const [items, setItems] = useState<LaunchManifest[]>([]);

  useEffect(() => {
    // Recovery records are browser-owned form state, not a source of onchain truth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readManifests().filter((item) => item.stage !== "token-created").slice(0, 3));
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
        {items.map((item) => (
          <Link href={`/launch/${item.id}`} key={item.id}>
            <RotateCcw />
            <span><strong>{item.input.hypedSymbol} <ChainBadge chain={item.chain} className="inline" /></strong><small>{item.analysis.symbol} reserve</small></span>
            <span>{relativeTime(item.updatedAt)}<small>{item.stage}</small></span>
            <ArrowRight />
          </Link>
        ))}
      </div>
    </section>
  );
}
