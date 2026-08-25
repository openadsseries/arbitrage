import { BOND_ABI, binaryReverseMint } from "@mint.club/v2-sdk";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { maximizeExecutable } from "./arbitrage-optimizer.mjs";

const WETH = "0x4200000000000000000000000000000000000006";
const BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";
const ONCHAIN_ROUTER = "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02";
const BPS = 10_000n;
const SLIPPAGE_BPS = BigInt(process.env.ARBITRAGE_SLIPPAGE_BPS || "50");
const POLL_MS = Number(process.env.ARBITRAGE_POLL_MS || "12000");
const MAX_POLL_MS = 60_000;
const GAS_MARGIN_BPS = BigInt(process.env.ARBITRAGE_GAS_MARGIN_BPS || "12000");
const RUN_ONCE = process.env.ARBITRAGE_KEEPER_ONCE === "1";

if (SLIPPAGE_BPS < 0n || SLIPPAGE_BPS >= 5_000n) throw new Error("ARBITRAGE_SLIPPAGE_BPS is outside the safe range.");
if (!Number.isFinite(POLL_MS) || POLL_MS < 1_000) throw new Error("ARBITRAGE_POLL_MS must be at least 1000.");
if (GAS_MARGIN_BPS < BPS) throw new Error("ARBITRAGE_GAS_MARGIN_BPS must be at least 10000.");

const EXECUTOR_ABI = parseAbi([
  "function strategyCount() view returns (uint256)",
  "function strategies(uint256 strategyId) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint64 executionCount,uint64 lastExecutionBlock,uint256 maxReservePerExecution,uint256 remainingVolume,uint256 minProfitReserve)",
  "function protocolFeeBps() view returns (uint16)",
  "function executorRewardBps() view returns (uint16)",
  "function execute(uint256 strategyId,uint8 direction,(uint256 amountInReserve,uint256 hAmountForMint,uint256 minimumWethOut,uint256 minimumHypedOut,uint256 minimumBondOut,uint256 minimumReserveOut) params) returns (uint256 ownerReturnReserve)",
]);
const ROUTER_ABI = parseAbi([
  "function routeExactInput((address tokenIn,address tokenOut,uint256 amountSpecified) params) view returns (((address tokenIn,address tokenOut,uint24 fee,address pool,uint8 version,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[] path,uint256 amountIn,uint256 amountOut) quote)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const executor = getAddress(required("NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V3"));
const privateKey = required("ARBITRAGE_KEEPER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("ARBITRAGE_KEEPER_PRIVATE_KEY is invalid.");
const account = privateKeyToAccount(privateKey);
const transport = http(required("BASE_RPC_URL"));
const client = createPublicClient({ chain: base, transport });
const wallet = createWalletClient({ account, chain: base, transport });
const cooldown = new Map();

function conciseError(error) {
  if (!(error instanceof Error)) return String(error);
  return error.shortMessage || error.details || error.message.split("\n")[0];
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function down(amount) {
  return amount * (BPS - SLIPPAGE_BPS) / BPS;
}

function ownerProfit(grossProfit, protocolFeeBps, executorRewardBps) {
  return grossProfit
    - grossProfit * BigInt(protocolFeeBps) / BPS
    - grossProfit * BigInt(executorRewardBps) / BPS;
}

async function quoteExactInput(tokenIn, tokenOut, amountIn) {
  if (amountIn <= 0n) throw new Error("Quote amount is zero.");
  const quote = await client.readContract({
    address: ONCHAIN_ROUTER,
    abi: ROUTER_ABI,
    functionName: "routeExactInput",
    args: [{ tokenIn, tokenOut, amountSpecified: amountIn }],
    blockTag: "pending",
  });
  if (quote.amountOut <= 0n) throw new Error("No executable route.");
  return quote.amountOut;
}

async function readBondState(strategy) {
  const [steps, currentSupply, maxSupply, decimals, bond] = await Promise.all([
    client.readContract({ address: BOND, abi: BOND_ABI, functionName: "getSteps", args: [strategy.hToken], blockTag: "pending" }),
    client.readContract({ address: strategy.hToken, abi: ERC20_ABI, functionName: "totalSupply", blockTag: "pending" }),
    client.readContract({ address: BOND, abi: BOND_ABI, functionName: "maxSupply", args: [strategy.hToken], blockTag: "pending" }),
    client.readContract({ address: strategy.hToken, abi: ERC20_ABI, functionName: "decimals", blockTag: "pending" }),
    client.readContract({ address: BOND, abi: BOND_ABI, functionName: "tokenBond", args: [strategy.hToken], blockTag: "pending" }),
  ]);
  if (getAddress(bond[4]) !== getAddress(strategy.reserveToken)) throw new Error("Reserve Token changed.");
  return { steps, currentSupply, maxSupply, decimals, mintRoyalty: Number(bond[1]) };
}

async function mintThenSell(strategy, budget, bondState, protocolFeeBps, rewardBps) {
  const hAmount = binaryReverseMint({
    reserveAmount: budget,
    bondSteps: bondState.steps,
    currentSupply: bondState.currentSupply,
    maxSupply: bondState.maxSupply,
    multiFactor: 10n ** BigInt(bondState.decimals),
    mintRoyalty: bondState.mintRoyalty,
    slippage: 0,
  });
  if (hAmount <= 0n) return null;
  const [reserveRequired] = await client.readContract({
    address: BOND,
    abi: BOND_ABI,
    functionName: "getReserveForToken",
    args: [strategy.hToken, hAmount],
    blockTag: "pending",
  });
  if (reserveRequired <= 0n || reserveRequired > budget) return null;
  const wethOut = await quoteExactInput(strategy.hToken, WETH, hAmount);
  const reserveOut = await quoteExactInput(WETH, strategy.reserveToken, wethOut);
  if (reserveOut <= reserveRequired) return null;
  const net = ownerProfit(reserveOut - reserveRequired, protocolFeeBps, rewardBps);
  if (net < strategy.minProfitReserve) return null;
  return {
    direction: 0,
    amount: reserveRequired,
    net,
    params: {
      amountInReserve: reserveRequired,
      hAmountForMint: hAmount,
      minimumWethOut: down(wethOut),
      minimumHypedOut: 0n,
      minimumBondOut: 0n,
      minimumReserveOut: down(reserveOut),
    },
  };
}

async function buyThenRedeem(strategy, budget, protocolFeeBps, rewardBps) {
  const wethOut = await quoteExactInput(strategy.reserveToken, WETH, budget);
  const hOut = await quoteExactInput(WETH, strategy.hToken, wethOut);
  const [reserveOut] = await client.readContract({
    address: BOND,
    abi: BOND_ABI,
    functionName: "getRefundForTokens",
    args: [strategy.hToken, hOut],
    blockTag: "pending",
  });
  if (reserveOut <= budget) return null;
  const net = ownerProfit(reserveOut - budget, protocolFeeBps, rewardBps);
  if (net < strategy.minProfitReserve) return null;
  return {
    direction: 1,
    amount: budget,
    net,
    params: {
      amountInReserve: budget,
      hAmountForMint: 0n,
      minimumWethOut: down(wethOut),
      minimumHypedOut: down(hOut),
      minimumBondOut: down(reserveOut),
      minimumReserveOut: down(reserveOut),
    },
  };
}

async function bestCandidates(strategy, available, protocolFeeBps, rewardBps) {
  const bondState = await readBondState(strategy);
  const [mintCandidate, redeemCandidate] = await Promise.all([
    maximizeExecutable(
      available,
      (budget) => mintThenSell(strategy, budget, bondState, protocolFeeBps, rewardBps),
      { coarseSteps: 7, refinementRounds: 3 },
    ),
    maximizeExecutable(
      available,
      (budget) => buyThenRedeem(strategy, budget, protocolFeeBps, rewardBps),
      { coarseSteps: 7, refinementRounds: 3 },
    ),
  ]);
  return [mintCandidate, redeemCandidate]
    .filter(Boolean)
    .sort((left, right) => left.net > right.net ? -1 : left.net < right.net ? 1 : 0);
}

async function tryExecute(strategyId, strategy, protocolFeeBps, rewardBps) {
  if ((cooldown.get(strategyId) || 0) > Date.now()) return;
  const [balance, allowance, reserveDecimals] = await Promise.all([
    client.readContract({ address: strategy.reserveToken, abi: ERC20_ABI, functionName: "balanceOf", args: [strategy.owner], blockTag: "pending" }),
    client.readContract({ address: strategy.reserveToken, abi: ERC20_ABI, functionName: "allowance", args: [strategy.owner, executor], blockTag: "pending" }),
    client.readContract({ address: strategy.reserveToken, abi: ERC20_ABI, functionName: "decimals", blockTag: "pending" }),
  ]);
  const available = [strategy.maxReserve, strategy.remainingVolume, balance, allowance]
    .reduce((left, right) => left < right ? left : right);
  if (available <= 0n) return;

  const candidates = await bestCandidates(strategy, available, protocolFeeBps, rewardBps);
  for (const candidate of candidates) {
    try {
      const args = [strategyId, candidate.direction, candidate.params];
      const simulation = await client.simulateContract({
        account,
        address: executor,
        abi: EXECUTOR_ABI,
        functionName: "execute",
        args,
        blockTag: "pending",
      });
      const [gas, gasPrice] = await Promise.all([
        client.estimateContractGas({ ...simulation.request, account, blockTag: "pending" }),
        client.getGasPrice(),
      ]);
      const simulatedOwnerProfit = simulation.result > candidate.amount ? simulation.result - candidate.amount : 0n;
      if (simulatedOwnerProfit < strategy.minProfitReserve) continue;
      const ownerShareBps = BPS - BigInt(protocolFeeBps) - BigInt(rewardBps);
      const expectedRewardReserve = ownerShareBps > 0n
        ? simulatedOwnerProfit * BigInt(rewardBps) / ownerShareBps
        : 0n;
      const rewardWeth = await quoteExactInput(strategy.reserveToken, WETH, expectedRewardReserve).catch(() => 0n);
      const requiredGasCover = gas * gasPrice * GAS_MARGIN_BPS / BPS;
      if (rewardWeth < requiredGasCover) continue;

      const hash = await wallet.writeContract(simulation.request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Execution reverted: ${hash}`);
      console.log(`[executed] strategy=${strategyId} ownerNet=${formatUnits(simulatedOwnerProfit, reserveDecimals)} reserve tx=${hash}`);
      cooldown.set(strategyId, Date.now() + POLL_MS);
      return;
    } catch (error) {
      console.warn(`[candidate-rejected] strategy=${strategyId} ${conciseError(error)}`);
    }
  }
}

async function readFeePolicy() {
  const [protocolFeeBps, rewardBps] = await Promise.all([
    client.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "protocolFeeBps", blockTag: "pending" }),
    client.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "executorRewardBps", blockTag: "pending" }),
  ]);
  if (protocolFeeBps !== 0 || rewardBps !== 2_000) throw new Error("Unexpected executor fee policy.");
  return [protocolFeeBps, rewardBps];
}

async function poll(protocolFeeBps, rewardBps) {
  try {
    const [count, block] = await Promise.all([
      client.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "strategyCount", blockTag: "pending" }),
      client.getBlock({ blockTag: "pending" }),
    ]);
    const ids = Array.from({ length: Number(count) }, (_, index) => BigInt(index + 1));
    const results = await client.multicall({
      allowFailure: true,
      blockTag: "pending",
      contracts: ids.map((id) => ({ address: executor, abi: EXECUTOR_ABI, functionName: "strategies", args: [id] })),
    });
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status !== "success") continue;
      const [
        owner,
        hToken,
        reserveToken,
        validUntil,
        active,
        ,
        ,
        maxReserve,
        remainingVolume,
        minProfitReserve,
      ] = result.result;
      const expired = BigInt(validUntil) !== 0n && BigInt(validUntil) < block.timestamp;
      if (!active || expired || remainingVolume === 0n) continue;
      await tryExecute(
        ids[index],
        { owner, hToken, reserveToken, maxReserve, remainingVolume, minProfitReserve },
        protocolFeeBps,
        rewardBps,
      );
    }
    return true;
  } catch (error) {
    console.error(`[keeper] ${conciseError(error)}`);
    return false;
  }
}

console.log(`[keeper] watching continuous Reserve Token executor ${executor} on Base as ${account.address}`);
const [protocolFeeBps, rewardBps] = await readFeePolicy();
console.log(`[keeper] policy verified: protocol=${Number(protocolFeeBps) / 100}% executor=${Number(rewardBps) / 100}%`);
let nextPollMs = POLL_MS;
while (true) {
  const healthy = await poll(protocolFeeBps, rewardBps);
  if (RUN_ONCE) {
    console.log(`[keeper] one check completed: ${healthy ? "healthy" : "failed"}`);
    break;
  }
  nextPollMs = healthy ? POLL_MS : Math.min(nextPollMs * 2, MAX_POLL_MS);
  await wait(nextPollMs);
}
