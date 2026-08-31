import { createPublicClient, fallback, getAddress, http, parseAbi } from "viem";
import { base } from "viem/chains";

const ABI = parseAbi([
  "function strategyCount() view returns (uint256)",
  "function strategies(uint256) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint64 executionCount,uint64 lastExecutionBlock,uint256 maxReservePerExecution,uint256 remainingVolume,uint256 minProfitReserve,uint256 maxFeeReimbursementReserve,uint16 minProfitBps)",
]);
const MIN_REQUEST_GAP_MS = 5_500;
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function integer(name, fallbackValue) {
  const value = process.env[name]?.trim();
  if (!value) return fallbackValue;
  if (!/^\d+$/.test(value)) throw new Error(`${name} is invalid.`);
  return Number(value);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rpcUrls() {
  return [
    required("BASE_RPC_URL"),
    ...(process.env.BASE_RPC_FALLBACK_URLS?.split(",") ?? []),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

const executor = getAddress(required("NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4"));
const appUrl = new URL(required("ARBITRAGE_APP_URL"));
if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") {
  throw new Error("ARBITRAGE_APP_URL must use HTTPS.");
}
const pollMs = Math.max(
  integer("ARBITRAGE_V4_KEEPER_POLL_MS", 120_000),
  30_000,
);
const rpcEndpoints = rpcUrls();
const transport = fallback(
  rpcEndpoints.map((url) => http(url, { retryCount: 0, timeout: 8_000 })),
  { rank: false, retryCount: 0 },
);
const client = createPublicClient({
  batch: { multicall: { batchSize: 16_384, wait: 10 } },
  chain: base,
  transport,
});

async function activeStrategies() {
  const count = await client.readContract({
    address: executor,
    abi: ABI,
    functionName: "strategyCount",
  });
  if (count === 0n) return [];
  const ids = Array.from({ length: Number(count) }, (_, index) =>
    BigInt(index + 1),
  );
  const strategies = await client.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({
      address: executor,
      abi: ABI,
      functionName: "strategies",
      args: [id],
    })),
  });
  const now = Math.floor(Date.now() / 1_000);
  return strategies.flatMap((strategy, index) => {
    const [owner, , , validUntil, active, , , , remainingVolume] = strategy;
    const live =
      active &&
      remainingVolume > 0n &&
      (validUntil === 0 || Number(validUntil) >= now);
    return live
      ? [{ id: ids[index].toString(), owner: getAddress(owner) }]
      : [];
  });
}

async function checkStrategy(strategy) {
  const endpoint = new URL("/api/arbitrage/relay", appUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...strategy, version: "v4" }),
  });
  const payload = await response.json();
  if (!response.ok && response.status !== 409 && response.status !== 429) {
    throw new Error(payload.error ?? `Relay returned ${response.status}.`);
  }
  const state = payload.status ?? payload.code ?? payload.error ?? "checked";
  console.log(`V4 strategy ${strategy.id}: ${state}`);
}

async function runOnce() {
  try {
    const strategies = await activeStrategies();
    if (strategies.length === 0) console.log("V4 keeper: no active strategies");
    for (const strategy of strategies) {
      await checkStrategy(strategy);
      await wait(MIN_REQUEST_GAP_MS);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

console.log(`V4 keeper: ${executor}`);
if (process.argv.includes("--once")) {
  await runOnce();
} else {
  for (;;) {
    await runOnce();
    process.exitCode = 0;
    await wait(pollMs);
  }
}
