import type { Address } from "viem";
import type { ContinuousArbitrageSnapshot } from "@/lib/arbitrage";

const inFlight = new Map<string, Promise<ContinuousArbitrageSnapshot>>();

export function readContinuousArbitrageSnapshot(wallet: Address) {
  const key = wallet.toLowerCase();
  const current = inFlight.get(key);
  if (current) return current;

  const request = fetch(`/api/arbitrage/v3?wallet=${wallet}`, { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json() as { snapshot?: ContinuousArbitrageSnapshot; error?: string };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "Could not read arbitrage.");
      return payload.snapshot;
    });
  inFlight.set(key, request);
  void request.finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }).catch(() => undefined);
  return request;
}
