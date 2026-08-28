import {
  createPublicClient,
  fallback,
  formatEther,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const V3_EXECUTOR = "0xbB7AF71818fD1a269f21D0b5E4d8F7CF5401Ac3C";
const V3_DEPLOYMENT_BLOCK = 50_422_622n;
const WETH = "0x4200000000000000000000000000000000000006";
const BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";
const ROUTER = "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02";
const DEFAULT_MINIMUM_BALANCE = 100_000_000_000_000n;
const SHARED_ABI = parseAbi([
  "function protocolFeeBps() view returns (uint16)",
  "function weth() view returns (address)",
  "function mintClubBond() view returns (address)",
  "function onchainRouter() view returns (address)",
]);
const V3_ABI = parseAbi([
  "function executorRewardBps() view returns (uint16)",
]);
const V4_ABI = parseAbi([
  "function executorProfitShareBps() view returns (uint16)",
  "function trustedExecutor() view returns (address)",
  "function operatorManager() view returns (address)",
  "function paused() view returns (bool)",
  "function baseGasPriceOracle() view returns (address)",
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function integer(name, fallbackValue) {
  const value = process.env[name]?.trim();
  if (!value) return fallbackValue;
  if (!/^\d+$/.test(value)) throw new Error(`${name} is invalid.`);
  return BigInt(value);
}

function address(name) {
  return getAddress(required(name));
}

const version =
  process.env.NEXT_PUBLIC_ARBITRAGE_V4_ENABLED === "true" ? "v4" : "v3";
const privateKey = required("ARBITRAGE_RELAYER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("ARBITRAGE_RELAYER_PRIVATE_KEY is invalid.");
}
const account = privateKeyToAccount(privateKey);
const executor =
  version === "v4"
    ? address("NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4")
    : address("NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V3");
const deploymentBlock = integer(
  version === "v4"
    ? "ARBITRAGE_EXECUTOR_V4_DEPLOYMENT_BLOCK"
    : "ARBITRAGE_EXECUTOR_V3_DEPLOYMENT_BLOCK",
  0n,
);
const minimumBalance = integer(
  "ARBITRAGE_RELAY_MIN_BALANCE_WEI",
  DEFAULT_MINIMUM_BALANCE,
);
const dailyGasLimit = integer(
  "ARBITRAGE_RELAY_DAILY_GAS_WEI",
  1_000_000_000_000_000n,
);
if (minimumBalance <= 0n) {
  throw new Error("ARBITRAGE_RELAY_MIN_BALANCE_WEI must be greater than zero.");
}
if (dailyGasLimit < minimumBalance) {
  throw new Error(
    "ARBITRAGE_RELAY_DAILY_GAS_WEI must not be lower than the minimum relay balance.",
  );
}
if (deploymentBlock <= 0n) {
  throw new Error(`${version.toUpperCase()} deployment block is missing.`);
}
if (version === "v3") {
  if (executor !== getAddress(V3_EXECUTOR)) {
    throw new Error("Unexpected V3 executor address.");
  }
  if (deploymentBlock !== V3_DEPLOYMENT_BLOCK) {
    throw new Error("Unexpected V3 deployment block.");
  }
}

const client = createPublicClient({
  chain: base,
  transport: fallback(
    [required("BASE_RPC_URL"), "https://mainnet.base.org"]
      .filter((url, index, endpoints) => endpoints.indexOf(url) === index)
      .map((url) => http(url, { retryCount: 0, timeout: 8_000 })),
    { rank: false, retryCount: 0 },
  ),
});
const [chainId, blockNumber, code, balance, protocolFeeBps, weth, bond, router] =
  await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getCode({ address: executor }),
    client.getBalance({ address: account.address }),
    client.readContract({
      address: executor,
      abi: SHARED_ABI,
      functionName: "protocolFeeBps",
    }),
    client.readContract({ address: executor, abi: SHARED_ABI, functionName: "weth" }),
    client.readContract({
      address: executor,
      abi: SHARED_ABI,
      functionName: "mintClubBond",
    }),
    client.readContract({
      address: executor,
      abi: SHARED_ABI,
      functionName: "onchainRouter",
    }),
  ]);

if (chainId !== base.id) throw new Error("RPC is not connected to Base.");
if (blockNumber < deploymentBlock) {
  throw new Error("RPC is behind the executor deployment.");
}
if (!code || code === "0x") {
  throw new Error(`${version.toUpperCase()} executor bytecode is missing.`);
}
if (protocolFeeBps !== 0) throw new Error("Unexpected protocol fee policy.");
if (getAddress(weth) !== getAddress(WETH)) {
  throw new Error("Unexpected WETH address.");
}
if (getAddress(bond) !== getAddress(BOND)) {
  throw new Error("Unexpected Mint Club address.");
}
if (getAddress(router) !== getAddress(ROUTER)) {
  throw new Error("Unexpected router address.");
}

if (version === "v4") {
  const [share, trustedExecutor, operatorManager, paused, oracle] =
    await Promise.all([
      client.readContract({
        address: executor,
        abi: V4_ABI,
        functionName: "executorProfitShareBps",
      }),
      client.readContract({
        address: executor,
        abi: V4_ABI,
        functionName: "trustedExecutor",
      }),
      client.readContract({
        address: executor,
        abi: V4_ABI,
        functionName: "operatorManager",
      }),
      client.readContract({
        address: executor,
        abi: V4_ABI,
        functionName: "paused",
      }),
      client.readContract({
        address: executor,
        abi: V4_ABI,
        functionName: "baseGasPriceOracle",
      }),
    ]);
  if (share !== 1_000) throw new Error("Unexpected V4 executor incentive.");
  if (getAddress(trustedExecutor) !== account.address) {
    throw new Error("V4 relay role does not match the configured key.");
  }
  if (getAddress(operatorManager) !== address("ARBITRAGE_V4_OPERATOR_MANAGER")) {
    throw new Error("V4 operator manager does not match configuration.");
  }
  if (getAddress(operatorManager) === getAddress(trustedExecutor)) {
    throw new Error("V4 operator manager and relay must be separate.");
  }
  if (paused) throw new Error("V4 executor is paused.");
  const oracleCode = await client.getCode({ address: getAddress(oracle) });
  if (!oracleCode || oracleCode === "0x") {
    throw new Error("Base fee oracle is unavailable.");
  }
} else {
  const reward = await client.readContract({
    address: executor,
    abi: V3_ABI,
    functionName: "executorRewardBps",
  });
  if (reward !== 2_000) throw new Error("Unexpected V3 executor reward.");
}

if (balance < minimumBalance) {
  throw new Error(
    `Relay needs at least ${formatEther(minimumBalance)} Base ETH.`,
  );
}

console.log("Arbitrage readiness: ready");
console.log(`Version: ${version.toUpperCase()}`);
console.log(`Network: Base (${chainId})`);
console.log(`Executor: ${executor}`);
console.log(`Deployment block: ${deploymentBlock}`);
console.log(`Relay: ${account.address}`);
console.log(`Relay gas: ${formatEther(balance)} ETH`);
console.log(
  version === "v4"
    ? "Policy: real fees + 10% of remaining profit"
    : "Policy: 0% protocol, 20% executor reward",
);
