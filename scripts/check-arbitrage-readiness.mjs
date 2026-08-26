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

const EXPECTED_EXECUTOR = "0xbB7AF71818fD1a269f21D0b5E4d8F7CF5401Ac3C";
const EXPECTED_DEPLOYMENT_BLOCK = 50_422_622n;
const EXPECTED_WETH = "0x4200000000000000000000000000000000000006";
const EXPECTED_BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";
const EXPECTED_ROUTER = "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02";
const DEFAULT_MINIMUM_BALANCE = 100_000_000_000_000n;
const ABI = parseAbi([
  "function protocolFeeBps() view returns (uint16)",
  "function executorRewardBps() view returns (uint16)",
  "function weth() view returns (address)",
  "function mintClubBond() view returns (address)",
  "function onchainRouter() view returns (address)",
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function integer(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} is invalid.`);
  return BigInt(value);
}

const privateKey = required("ARBITRAGE_RELAYER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("ARBITRAGE_RELAYER_PRIVATE_KEY is invalid.");
}
const keeperKey = process.env.ARBITRAGE_KEEPER_PRIVATE_KEY?.trim();
if (keeperKey && keeperKey.toLowerCase() === privateKey.toLowerCase()) {
  throw new Error("Relay and keeper must use different wallets.");
}

const account = privateKeyToAccount(privateKey);
const executor = getAddress(required("NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V3"));
const deploymentBlock = integer("ARBITRAGE_EXECUTOR_V3_DEPLOYMENT_BLOCK", 0n);
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
if (executor !== getAddress(EXPECTED_EXECUTOR)) {
  throw new Error("Unexpected V3 executor address.");
}
if (deploymentBlock !== EXPECTED_DEPLOYMENT_BLOCK) {
  throw new Error("Unexpected V3 deployment block.");
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
const [chainId, blockNumber, code, balance, policy, weth, bond, router] =
  await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getCode({ address: executor }),
    client.getBalance({ address: account.address }),
    Promise.all([
      client.readContract({
        address: executor,
        abi: ABI,
        functionName: "protocolFeeBps",
      }),
      client.readContract({
        address: executor,
        abi: ABI,
        functionName: "executorRewardBps",
      }),
    ]),
    client.readContract({ address: executor, abi: ABI, functionName: "weth" }),
    client.readContract({
      address: executor,
      abi: ABI,
      functionName: "mintClubBond",
    }),
    client.readContract({
      address: executor,
      abi: ABI,
      functionName: "onchainRouter",
    }),
  ]);

if (chainId !== base.id) throw new Error("RPC is not connected to Base.");
if (blockNumber < deploymentBlock)
  throw new Error("RPC is behind the executor deployment.");
if (!code || code === "0x") throw new Error("V3 executor bytecode is missing.");
if (policy[0] !== 0 || policy[1] !== 2_000)
  throw new Error("Unexpected fee policy.");
if (getAddress(weth) !== getAddress(EXPECTED_WETH))
  throw new Error("Unexpected WETH address.");
if (getAddress(bond) !== getAddress(EXPECTED_BOND))
  throw new Error("Unexpected Mint Club address.");
if (getAddress(router) !== getAddress(EXPECTED_ROUTER))
  throw new Error("Unexpected router address.");
if (balance < minimumBalance) {
  throw new Error(
    `Relay needs at least ${formatEther(minimumBalance)} Base ETH.`,
  );
}

console.log("Arbitrage readiness: ready");
console.log(`Network: Base (${chainId})`);
console.log(`Executor: ${executor}`);
console.log(`Relay: ${account.address}`);
console.log(`Relay gas: ${formatEther(balance)} ETH`);
console.log("Policy: 0% protocol, 20% executor reward");
