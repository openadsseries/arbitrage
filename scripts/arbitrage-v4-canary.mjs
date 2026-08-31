import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  fallback,
  getAddress,
  http,
  parseAbi,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const HMT = getAddress("0x467bA2Da859648dc7C258BcF6572adE499250E6a");
const MT = getAddress("0xFf45161474C39cB00699070Dd49582e417b57a7E");
const EXECUTOR = getAddress(required("NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4"));
const APP_URL = new URL(
  process.env.ARBITRAGE_APP_URL?.trim() || "http://localhost:3000",
);
const BUY_WEI = 950_000_000_000_000n;
const DEPLOYER_GAS_BUFFER_WEI = 200_000_000_000_000n;
const RELAY_MINIMUM_WEI = integer(
  "ARBITRAGE_RELAY_MIN_BALANCE_WEI",
  100_000_000_000_000n,
);
const MIN_PROFIT_BPS = 10;
const MAX_FEE_BPS = 200n;
const BPS = 10_000n;
const RESUME = process.argv.includes("--resume");
const CLEANUP = process.argv.includes("--cleanup");

const executorAbi = parseAbi([
  "event StrategyStarted(uint256 indexed strategyId,address indexed owner,address indexed hToken,address reserveToken,uint256 maxReservePerExecution,uint256 totalVolume,uint256 minProfitReserve,uint16 minProfitBps,uint256 maxFeeReimbursementReserve,uint40 validUntil)",
  "function startStrategy(address hToken,uint256 maxReservePerExecution,uint256 totalVolume,uint256 minProfitReserve,uint16 minProfitBps,uint256 maxFeeReimbursementReserve,uint40 validUntil) returns (uint256 strategyId)",
  "function stopStrategy(uint256 strategyId)",
  "function activeStrategyId(address owner,address hToken) view returns (uint256)",
  "function strategies(uint256 strategyId) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint64 executionCount,uint64 lastExecutionBlock,uint256 maxReservePerExecution,uint256 remainingVolume,uint256 minProfitReserve,uint256 maxFeeReimbursementReserve,uint16 minProfitBps)",
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

function privateKey(name) {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} is invalid.`);
  return value;
}

async function json(path, init) {
  const response = await fetch(new URL(path, APP_URL), init);
  const payload = await response.json();
  if (
    !response.ok &&
    payload.status === "unavailable" &&
    payload.code === "quote-unavailable"
  ) {
    return payload;
  }
  if (!response.ok)
    throw new Error(payload.error || `${path} returned ${response.status}.`);
  return payload;
}

function rpcUrls() {
  return [
    process.env.ARBITRAGE_TRANSACTION_RPC_URL,
    ...(process.env.ARBITRAGE_TRANSACTION_RPC_URLS?.split(",") ?? []),
    process.env.BASE_RPC_URL,
    ...(process.env.BASE_RPC_FALLBACK_URLS?.split(",") ?? []),
  ]
    .map((value) => value?.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function uniswap(action, amountRaw, swapper) {
  return json("/api/uniswap/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      chain: "base",
      token: MT,
      side: "buy",
      amountRaw: amountRaw.toString(),
      swapper,
    }),
  });
}

function transactionRequest(transaction) {
  return {
    to: getAddress(transaction.to),
    data: transaction.data,
    value: BigInt(transaction.value),
    ...(transaction.gasLimit ? { gas: BigInt(transaction.gasLimit) } : {}),
    ...(transaction.maxFeePerGas
      ? { maxFeePerGas: BigInt(transaction.maxFeePerGas) }
      : {}),
    ...(transaction.maxPriorityFeePerGas
      ? { maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas) }
      : {}),
    ...(transaction.gasPrice ? { gasPrice: BigInt(transaction.gasPrice) } : {}),
  };
}

const deployer = privateKeyToAccount(
  privateKey("ARBITRAGE_KEEPER_PRIVATE_KEY"),
);
const relay = privateKeyToAccount(privateKey("ARBITRAGE_RELAYER_PRIVATE_KEY"));
required("BASE_RPC_URL");
const transactionRpcUrls = rpcUrls();
const transactionTransports = transactionRpcUrls.map((url) =>
  http(url, { retryCount: 0, timeout: 8_000 }),
);
const primaryTransport =
  transactionTransports.length === 1
    ? transactionTransports[0]
    : fallback(transactionTransports, { rank: false, retryCount: 0 });
const primaryPublicClient = createPublicClient({
  batch: { multicall: { batchSize: 16_384, wait: 10 } },
  chain: base,
  transport: primaryTransport,
});
const deployerClient = createWalletClient({
  account: deployer,
  chain: base,
  transport: primaryTransport,
});
const relayClient = createWalletClient({
  account: relay,
  chain: base,
  transport: primaryTransport,
});

async function receipt(hash) {
  const result = await primaryPublicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (result.status !== "success")
    throw new Error(`Transaction failed: ${hash}`);
  await waitForBlock(result.blockNumber);
  return result;
}

async function waitForBlock(minimum) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const blockNumber = await primaryPublicClient.getBlockNumber({
      cacheTime: 0,
    });
    if (blockNumber >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Transaction block ${minimum} was not readable in time.`);
}

async function waitForBalance(address, minimum) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const balance = await primaryPublicClient.getBalance({ address });
    if (balance >= minimum) return balance;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(
    "Funded balance was not visible on the transaction RPC in time.",
  );
}

async function waitForTokenBalance(address, minimum) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const balance = await primaryPublicClient.readContract({
      address: MT,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    if (balance >= minimum) return balance;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(
    "Purchased MT was not visible on the transaction RPC in time.",
  );
}

async function revokeAndStop(strategyIdHint = 0n) {
  const strategyId =
    strategyIdHint ||
    (await primaryPublicClient.readContract({
      address: EXECUTOR,
      abi: executorAbi,
      functionName: "activeStrategyId",
      args: [deployer.address, HMT],
    }));
  if (strategyId > 0n) {
    const strategy = await primaryPublicClient.readContract({
      address: EXECUTOR,
      abi: executorAbi,
      functionName: "strategies",
      args: [strategyId],
    });
    if (strategy[4]) {
      const simulation = await primaryPublicClient.simulateContract({
        account: deployer,
        address: EXECUTOR,
        abi: executorAbi,
        functionName: "stopStrategy",
        args: [strategyId],
      });
      const stopHash = await deployerClient.writeContract(simulation.request);
      await receipt(stopHash);
      console.log(`Stop transaction: ${stopHash}`);
    }
  }
  const allowance = await primaryPublicClient.readContract({
    address: MT,
    abi: erc20Abi,
    functionName: "allowance",
    args: [deployer.address, EXECUTOR],
  });
  if (allowance > 0n) {
    const simulation = await primaryPublicClient.simulateContract({
      account: deployer,
      address: MT,
      abi: erc20Abi,
      functionName: "approve",
      args: [EXECUTOR, 0n],
    });
    const revokeHash = await deployerClient.writeContract(simulation.request);
    await receipt(revokeHash);
    console.log(`Revoke transaction: ${revokeHash}`);
  }
}

async function balances() {
  const [deployerEth, relayEth, deployerMt] = await Promise.all([
    primaryPublicClient.getBalance({ address: deployer.address }),
    primaryPublicClient.getBalance({ address: relay.address }),
    primaryPublicClient.readContract({
      address: MT,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [deployer.address],
    }),
  ]);
  return { deployerEth, relayEth, deployerMt };
}

async function relayPreflight() {
  const status = await json("/api/arbitrage/relay?version=v4");
  if (!status.ready) {
    throw new Error(status.message || "V4 relay preflight failed.");
  }
}

async function executeWithRelayRetry(strategyId) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await json("/api/arbitrage/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        owner: deployer.address,
        strategyId: strategyId.toString(),
        version: "v4",
      }),
    });
    lastResult = result;
    if (
      result.status !== "unavailable" ||
      result.code !== "quote-unavailable" ||
      attempt === 3
    ) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 4_000));
  }
  return lastResult;
}

if (CLEANUP) {
  await revokeAndStop();
  console.log("V4 canary cleanup: stopped and revoked");
  process.exit(0);
}

const quote = RESUME ? null : await uniswap("quote", BUY_WEI, deployer.address);
const before = await balances();
console.log("V4 canary preview");
if (quote) {
  console.log(`Buy: ${formatEther(BUY_WEI)} ETH`);
  console.log(
    `Minimum quoted MT: ${formatUnits(BigInt(quote.outputAmountRaw), 18)} MT`,
  );
}
console.log(`Deployer gas: ${formatEther(before.deployerEth)} ETH`);
console.log(`Relay gas: ${formatEther(before.relayEth)} ETH`);
if (RESUME) console.log(`Resume MT: ${formatUnits(before.deployerMt, 18)} MT`);

if (!process.argv.includes("--execute")) {
  console.log("Preview only. Pass --execute after explicit approval.");
  process.exit(0);
}

await relayPreflight();
console.log("V4 relay preflight: passed");

const existingStrategy = await primaryPublicClient.readContract({
  address: EXECUTOR,
  abi: executorAbi,
  functionName: "activeStrategyId",
  args: [deployer.address, HMT],
});
if (existingStrategy !== 0n)
  throw new Error("The canary wallet already has an active hMT strategy.");

let cleanupNeeded = false;
let cleanupStrategyId = 0n;
try {
  let purchased = before.deployerMt;
  if (RESUME) {
    if (purchased <= 0n) throw new Error("There is no purchased MT to resume.");
  } else {
    const requiredDeployerEth = BUY_WEI + DEPLOYER_GAS_BUFFER_WEI;
    if (before.deployerEth < requiredDeployerEth) {
      const funding = requiredDeployerEth - before.deployerEth;
      if (before.relayEth - funding <= RELAY_MINIMUM_WEI) {
        throw new Error(
          "Relay balance cannot fund the canary and remain ready.",
        );
      }
      const fundingHash = await relayClient.sendTransaction({
        to: deployer.address,
        value: funding,
      });
      await receipt(fundingHash);
      await waitForBalance(deployer.address, requiredDeployerEth);
      console.log(`Internal gas funding: ${formatEther(funding)} ETH`);
      console.log(`Internal gas funding transaction: ${fundingHash}`);
    }

    const prepared = await uniswap("transaction", BUY_WEI, deployer.address);
    const purchaseHash = await deployerClient.sendTransaction(
      transactionRequest(prepared.swap),
    );
    await receipt(purchaseHash);
    if (!quote) throw new Error("The purchase quote is unavailable.");
    const afterBuyMt = await waitForTokenBalance(
      deployer.address,
      before.deployerMt + BigInt(quote.outputAmountRaw),
    );
    purchased = afterBuyMt - before.deployerMt;
    if (purchased <= 0n) throw new Error("The MT purchase returned no tokens.");
    console.log(`Purchase transaction: ${purchaseHash}`);
  }
  console.log(
    `${RESUME ? "Existing budget" : "Purchased"}: ${formatUnits(purchased, 18)} MT`,
  );

  const currentAllowance = await primaryPublicClient.readContract({
    address: MT,
    abi: erc20Abi,
    functionName: "allowance",
    args: [deployer.address, EXECUTOR],
  });
  if (currentAllowance < purchased) {
    const approval = await primaryPublicClient.simulateContract({
      account: deployer,
      address: MT,
      abi: erc20Abi,
      functionName: "approve",
      args: [EXECUTOR, purchased],
    });
    const approvalHash = await deployerClient.writeContract(approval.request);
    cleanupNeeded = true;
    await receipt(approvalHash);
    console.log(`Approval transaction: ${approvalHash}`);
  } else {
    cleanupNeeded = true;
    console.log(`Existing approval: ${formatUnits(currentAllowance, 18)} MT`);
  }

  const maximumFee = (purchased * MAX_FEE_BPS) / BPS;
  const start = await primaryPublicClient.simulateContract({
    account: deployer,
    address: EXECUTOR,
    abi: executorAbi,
    functionName: "startStrategy",
    args: [
      HMT,
      purchased,
      purchased,
      1n,
      MIN_PROFIT_BPS,
      maximumFee,
      BigInt(Math.floor(Date.now() / 1_000) + 60 * 60),
    ],
  });
  const startHash = await deployerClient.writeContract(start.request);
  const startReceipt = await receipt(startHash);
  console.log(`Strategy transaction: ${startHash}`);
  const startedEvents = parseEventLogs({
    abi: executorAbi,
    logs: startReceipt.logs,
    eventName: "StrategyStarted",
  });
  const strategyId = startedEvents[0]?.args.strategyId || 0n;
  if (strategyId === 0n) throw new Error("The V4 strategy did not start.");
  cleanupStrategyId = strategyId;
  console.log(`Strategy: ${strategyId}`);

  const relayResult = await executeWithRelayRetry(strategyId);
  console.log(
    `Relay result: ${relayResult.status}${relayResult.code ? ` (${relayResult.code})` : ""}${relayResult.error ? ` - ${relayResult.error}` : ""}`,
  );
  if (relayResult.status !== "executed" || !relayResult.hash) {
    throw new Error(
      `V4 did not execute: ${relayResult.error || relayResult.status}`,
    );
  }
  const executionReceipt = await receipt(relayResult.hash);

  const [finalStrategy, finalAllowance, finalMt] = await Promise.all([
    primaryPublicClient.readContract({
      address: EXECUTOR,
      abi: executorAbi,
      functionName: "strategies",
      args: [strategyId],
      blockNumber: executionReceipt.blockNumber,
    }),
    primaryPublicClient.readContract({
      address: MT,
      abi: erc20Abi,
      functionName: "allowance",
      args: [deployer.address, EXECUTOR],
      blockNumber: executionReceipt.blockNumber,
    }),
    primaryPublicClient.readContract({
      address: MT,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [deployer.address],
      blockNumber: executionReceipt.blockNumber,
    }),
  ]);
  if (finalStrategy[4] || finalStrategy[8] !== 0n || finalAllowance !== 0n) {
    throw new Error("V4 canary left an active strategy, budget, or allowance.");
  }
  cleanupNeeded = false;
  cleanupStrategyId = 0n;
  console.log(`Execution: ${relayResult.hash}`);
  console.log(`Final MT: ${formatUnits(finalMt, 18)} MT`);
  console.log("V4 canary: passed");
} finally {
  if (cleanupNeeded) {
    try {
      await revokeAndStop(cleanupStrategyId);
      console.log("V4 canary cleanup: stopped and revoked");
    } catch (cleanupError) {
      console.error(
        `V4 canary cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."}`,
      );
    }
  }
}
