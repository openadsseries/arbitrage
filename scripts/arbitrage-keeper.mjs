import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  parseAbi,
} from "viem";
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
if (SLIPPAGE_BPS < 0n || SLIPPAGE_BPS >= 5_000n) throw new Error("ARBITRAGE_SLIPPAGE_BPS is outside the safe range.");
if (!Number.isFinite(POLL_MS) || POLL_MS < 1_000) throw new Error("ARBITRAGE_POLL_MS must be at least 1000.");
if (GAS_MARGIN_BPS < BPS) throw new Error("ARBITRAGE_GAS_MARGIN_BPS must be at least 10000.");

const EXECUTOR_ABI = parseAbi([
  "function strategyCount() view returns (uint256)",
  "function strategies(uint256 strategyId) view returns (address owner,address hToken,address reserveToken,uint40 validUntil,bool active,uint256 maxWethPerExecution,uint256 minProfit)",
  "function protocolFeeBps() view returns (uint16)",
  "function executorRewardBps() view returns (uint16)",
  "function execute(uint256 strategyId,uint8 direction,uint256 amountIn,uint256 hAmountForMint,uint256 minimumFirstSwapOut,uint256 minimumBondOut,uint256 minimumFinalSwapOut) returns (uint256 ownerReturn)",
]);
const BOND_ABI = parseAbi([
  "function getReserveForToken(address token,uint256 tokensToMint) view returns (uint256 reserveAmount,uint256 royalty)",
  "function getRefundForTokens(address token,uint256 tokensToBurn) view returns (uint256 refundAmount,uint256 royalty)",
  "function maxSupply(address token) view returns (uint256)",
]);
const ROUTER_ABI = parseAbi([
  "function routeExactInput((address tokenIn,address tokenOut,uint256 amountSpecified) params) view returns (((address tokenIn,address tokenOut,uint24 fee,address pool,uint8 version,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[] path,uint256 amountIn,uint256 amountOut) quote)",
  "function routeExactOutput((address tokenIn,address tokenOut,uint256 amountSpecified) params) view returns (((address tokenIn,address tokenOut,uint24 fee,address pool,uint8 version,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[] path,uint256 amountIn,uint256 amountOut) quote)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const executor = getAddress(required("NEXT_PUBLIC_ARBITRAGE_EXECUTOR"));
const privateKey = required("ARBITRAGE_KEEPER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("ARBITRAGE_KEEPER_PRIVATE_KEY is invalid.");
const account = privateKeyToAccount(privateKey);
const transport = http(required("BASE_RPC_URL"));
const client = createPublicClient({ chain: base, transport });
const wallet = createWalletClient({ account, chain: base, transport });
const cooldown = new Map();

function conciseError(error) {
  if (!(error instanceof Error)) return String(error);
  const value = error;
  return value.shortMessage || value.details || value.message.split("\n")[0];
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function down(amount, bps = SLIPPAGE_BPS) {
  return amount * (BPS - bps) / BPS;
}

function up(amount, bps = SLIPPAGE_BPS) {
  return (amount * (BPS + bps) + BPS - 1n) / BPS;
}

async function quoteExactInput(tokenIn, tokenOut, amountIn) {
  const quote = await client.readContract({
    address: ONCHAIN_ROUTER,
    abi: ROUTER_ABI,
    functionName: "routeExactInput",
    args: [{ tokenIn, tokenOut, amountSpecified: amountIn }],
    blockTag: "pending",
  });
  return quote.amountOut;
}

async function quoteExactOutput(tokenIn, tokenOut, amountOut) {
  const quote = await client.readContract({
    address: ONCHAIN_ROUTER,
    abi: ROUTER_ABI,
    functionName: "routeExactOutput",
    args: [{ tokenIn, tokenOut, amountSpecified: amountOut }],
    blockTag: "pending",
  });
  return quote.amountIn;
}

async function mintCost(strategy, hAmount) {
  const [reserveRequired] = await client.readContract({
    address: BOND,
    abi: BOND_ABI,
    functionName: "getReserveForToken",
    args: [strategy.hToken, hAmount],
    blockTag: "pending",
  });
  const wethCost = await quoteExactOutput(WETH, strategy.reserveToken, reserveRequired);
  return { wethCost };
}

async function maximumMintAmount(strategy, maximumWeth) {
  const [maxSupply, totalSupply] = await Promise.all([
    client.readContract({ address: BOND, abi: BOND_ABI, functionName: "maxSupply", args: [strategy.hToken], blockTag: "pending" }),
    client.readContract({ address: strategy.hToken, abi: ERC20_ABI, functionName: "totalSupply", blockTag: "pending" }),
  ]);
  let low = 0n;
  let high = maxSupply - totalSupply;
  for (let index = 0; index < 28 && low < high; index += 1) {
    const midpoint = (low + high + 1n) / 2n;
    try {
      const { wethCost } = await mintCost(strategy, midpoint);
      if (up(wethCost) <= maximumWeth) low = midpoint;
      else high = midpoint - 1n;
    } catch {
      high = midpoint - 1n;
    }
  }
  return low;
}

function ownerNet(gross, protocolFeeBps, rewardBps) {
  return gross - gross * BigInt(protocolFeeBps) / BPS - gross * BigInt(rewardBps) / BPS;
}

async function bestMintRoute(strategy, protocolFeeBps, rewardBps, maximumWeth) {
  const maximum = await maximumMintAmount(strategy, maximumWeth);
  return maximizeExecutable(maximum, async (hAmount) => {
    try {
      const { wethCost } = await mintCost(strategy, hAmount);
      const maxInput = up(wethCost);
      if (maxInput > maximumWeth) return null;
      const finalOut = await quoteExactInput(strategy.hToken, WETH, hAmount);
      if (finalOut <= wethCost) return null;
      const gross = finalOut - wethCost;
      const net = ownerNet(gross, protocolFeeBps, rewardBps);
      if (net < strategy.minProfit) return null;
      return { amount: hAmount, direction: 0, amountIn: maxInput, hAmount, minFirst: 0n, minBond: 0n, minFinal: down(finalOut), gross, net };
    } catch {
      return null;
    }
  });
}

async function bestRedeemRoute(strategy, protocolFeeBps, rewardBps, maximumWeth) {
  return maximizeExecutable(maximumWeth, async (amountIn) => {
    try {
      const hOut = await quoteExactInput(WETH, strategy.hToken, amountIn);
      const [reserveOut] = await client.readContract({
        address: BOND,
        abi: BOND_ABI,
        functionName: "getRefundForTokens",
        args: [strategy.hToken, hOut],
        blockTag: "pending",
      });
      const finalOut = await quoteExactInput(strategy.reserveToken, WETH, reserveOut);
      if (finalOut <= amountIn) return null;
      const gross = finalOut - amountIn;
      const net = ownerNet(gross, protocolFeeBps, rewardBps);
      if (net < strategy.minProfit) return null;
      const widerSlippage = SLIPPAGE_BPS * 2n < BPS ? SLIPPAGE_BPS * 2n : SLIPPAGE_BPS;
      return { amount: amountIn, direction: 1, amountIn, hAmount: 0n, minFirst: down(hOut), minBond: down(reserveOut), minFinal: down(finalOut, widerSlippage), gross, net };
    } catch {
      return null;
    }
  });
}

async function tryExecute(strategyId, strategy, protocolFeeBps, rewardBps) {
  if ((cooldown.get(strategyId) || 0) > Date.now()) return;
  const [ownerBalance, ownerAllowance] = await Promise.all([
    client.readContract({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [strategy.owner], blockTag: "pending" }),
    client.readContract({ address: WETH, abi: ERC20_ABI, functionName: "allowance", args: [strategy.owner, executor], blockTag: "pending" }),
  ]);
  const available = [strategy.maxWeth, ownerBalance, ownerAllowance].reduce((left, right) => left < right ? left : right);
  if (available <= 0n) return;
  const [mintRoute, redeemRoute] = await Promise.all([
    bestMintRoute(strategy, protocolFeeBps, rewardBps, available),
    bestRedeemRoute(strategy, protocolFeeBps, rewardBps, available),
  ]);
  const routes = [mintRoute, redeemRoute].filter(Boolean).sort((a, b) => a.net > b.net ? -1 : a.net < b.net ? 1 : 0);
  for (const route of routes) {
    try {
      const args = [strategyId, route.direction, route.amountIn, route.hAmount, route.minFirst, route.minBond, route.minFinal];
      const simulation = await client.simulateContract({ account, address: executor, abi: EXECUTOR_ABI, functionName: "execute", args, blockTag: "pending" });
      const [gas, gasPrice] = await Promise.all([
        client.estimateContractGas({ ...simulation.request, account, blockTag: "pending" }),
        client.getGasPrice(),
      ]);
      const simulatedOwnerProfit = simulation.result > route.amountIn ? simulation.result - route.amountIn : 0n;
      const ownerShareBps = BPS - BigInt(protocolFeeBps) - BigInt(rewardBps);
      const expectedReward = ownerShareBps > 0n ? simulatedOwnerProfit * BigInt(rewardBps) / ownerShareBps : 0n;
      const requiredGasCover = gas * gasPrice * GAS_MARGIN_BPS / BPS;
      if (simulatedOwnerProfit < strategy.minProfit || expectedReward < requiredGasCover) continue;

      const hash = await wallet.writeContract(simulation.request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Execution reverted: ${hash}`);
      console.log(`[executed] strategy=${strategyId} ownerNet=${formatEther(simulatedOwnerProfit)} WETH tx=${hash}`);
      cooldown.set(strategyId, Date.now() + POLL_MS);
      return;
    } catch (error) {
      console.warn(`[candidate-rejected] strategy=${strategyId} ${conciseError(error)}`);
    }
  }
}

async function readFeePolicy() {
  let retryMs = 2_000;
  while (true) {
    try {
      return await Promise.all([
        client.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "protocolFeeBps", blockTag: "pending" }),
        client.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "executorRewardBps", blockTag: "pending" }),
      ]);
    } catch (error) {
      console.warn(`[keeper] fee policy read delayed: ${conciseError(error)}`);
      await wait(retryMs);
      retryMs = Math.min(retryMs * 2, MAX_POLL_MS);
    }
  }
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
      const [owner, hToken, reserveToken, validUntil, active, maxWeth, minProfit] = result.result;
      if (!active || BigInt(validUntil) < block.timestamp) continue;
      await tryExecute(ids[index], { owner, hToken, reserveToken, maxWeth, minProfit }, protocolFeeBps, rewardBps);
    }
    return true;
  } catch (error) {
    console.error(`[keeper] ${conciseError(error)}`);
    return false;
  }
}

console.log(`[keeper] watching ${executor} on Base as ${account.address}`);
const [protocolFeeBps, rewardBps] = await readFeePolicy();
console.log(`[keeper] policy verified: protocol=${Number(protocolFeeBps) / 100}% executor=${Number(rewardBps) / 100}%`);
let nextPollMs = POLL_MS;
while (true) {
  const healthy = await poll(protocolFeeBps, rewardBps);
  nextPollMs = healthy ? POLL_MS : Math.min(nextPollMs * 2, MAX_POLL_MS);
  await wait(nextPollMs);
}
