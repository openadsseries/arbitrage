import type { Address } from "viem";
import type { LaunchManifest, TokenAnalysis } from "@/lib/types";

export const MANIFEST_STORAGE_KEY = "hyped.launch-manifests.v3";

export function createManifest(analysis: TokenAnalysis): LaunchManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    stage: "analyzed",
    chain: analysis.chain,
    owner: null,
    input: {
      backingToken: analysis.tokenAddress,
      hypedName: `Hyped ${analysis.symbol}`,
      hypedSymbol: `h${analysis.symbol}`.slice(0, 12),
    },
    analysis,
    configuration: null,
    liquidity: null,
    execution: {
      txs: {},
      hypedToken: null,
      pool: null,
      lpTokenId: null,
    },
    provenance: {
      analysisBlock: analysis.blockNumber,
      quoteExpiresAt: null,
      policyVersion: "2026-08.1",
    },
  };
}

export function readManifests(): LaunchManifest[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(MANIFEST_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? (parsed as LaunchManifest[]).map((manifest) => ({
          ...manifest,
          liquidity: manifest.liquidity ?? null,
        }))
      : [];
  } catch {
    return [];
  }
}

export function saveManifest(manifest: LaunchManifest): LaunchManifest {
  const manifests = readManifests();
  const updated = { ...manifest, updatedAt: new Date().toISOString() };
  const next = [updated, ...manifests.filter((item) => item.id !== manifest.id)];
  localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(next.slice(0, 50)));
  window.dispatchEvent(new Event("hyped:manifest-updated"));
  return updated;
}

export function readManifest(id: string) {
  return readManifests().find((manifest) => manifest.id === id) ?? null;
}

export function deleteManifest(id: string) {
  if (typeof window === "undefined") return;
  const next = readManifests().filter((manifest) => manifest.id !== id);
  localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("hyped:manifest-updated"));
}

export function attachOwner(manifest: LaunchManifest, owner: Address) {
  return saveManifest({ ...manifest, owner });
}
