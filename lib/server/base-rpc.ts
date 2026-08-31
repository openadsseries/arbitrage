import "server-only";

import { fallback, http, type Transport } from "viem";

export const DEFAULT_BASE_RPC_URL = "https://base-rpc.publicnode.com";
export const DEFAULT_BASE_RPC_FALLBACK_URLS =
  "https://base-mainnet.public.blastapi.io,https://mainnet.base.org";

export function parseBaseRpcUrls(
  primary = process.env.BASE_RPC_URL || DEFAULT_BASE_RPC_URL,
  fallbacks = process.env.BASE_RPC_FALLBACK_URLS ||
    DEFAULT_BASE_RPC_FALLBACK_URLS,
) {
  return [primary, ...(fallbacks?.split(",") ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
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
