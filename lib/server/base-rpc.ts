import "server-only";

import { fallback, http, type Transport } from "viem";

const KNOWN_PUBLIC_RPC_HOSTS = new Set([
  "base-rpc.publicnode.com",
  "base-mainnet.public.blastapi.io",
  "mainnet.base.org",
  "mainnet-preconf.base.org",
]);

export function parseBaseRpcUrls(
  primary = process.env.BASE_RPC_URL,
  fallbacks = process.env.BASE_RPC_FALLBACK_URLS,
) {
  return [primary, ...(fallbacks?.split(",") ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

export function isKnownPublicBaseRpc(url: string) {
  try {
    return KNOWN_PUBLIC_RPC_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return true;
  }
}

export function assertProductionV4Rpc(urls: string[]) {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.NEXT_PUBLIC_ARBITRAGE_V4_ENABLED !== "true"
  ) {
    return;
  }
  if (
    process.env.ARBITRAGE_RPC_PRODUCTION_READY !== "true" ||
    urls.length === 0 ||
    urls.every(isKnownPublicBaseRpc)
  ) {
    throw new Error("Authenticated Base RPC required.");
  }
}

export function createBaseRpcTransport(urls = parseBaseRpcUrls()): Transport {
  if (urls.length === 0) throw new Error("Relay not configured.");
  const transports = urls.map((url) =>
    http(url, { retryCount: 0, timeout: 8_000 }),
  );
  return transports.length === 1
    ? transports[0]
    : fallback(transports, { rank: false, retryCount: 0 });
}
