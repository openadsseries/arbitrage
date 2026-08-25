import "server-only";

import { BOND_ABI, binaryReverseMint, mintclub } from "@mint.club/v2-sdk";
import { getAddress, parseAbi, type Address } from "viem";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ERC20_PERMISSION_ABI,
  getArbitrageCurveAmounts,
  getArbitrageExecutorV3,
} from "@/lib/arbitrage";
import { CHAINS } from "@/lib/chains";

const ONCHAIN_ROUTER = "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02" as const;
const BPS = 10_000n;
const SLIPPAGE_BPS = 50n;
const GAS_MARGIN_BPS = 12_000n;

const ROUTER_ABI = parseAbi([
  "function routeExactInput((address tokenIn,address tokenOut,uint256 amountSpecified) params) view returns (((address tokenIn,address tokenOut,uint24 fee,address pool,uint8 version,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[] path,uint256 amountIn,uint256 amountOut) quote)",
]);
const ERC20_META_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

type Strategy = {
  owner: Address;
  hToken: Address;
  reserveToken: Address;
  active: boolean;
  validUntil: bigint;
  maxReserve: bigint;
  remainingVolume: bigint;
  minProfitReserve: bigint;
};

type Candidate = {
  direction: 0 | 1;
  amount: bigint;
  executorReward: bigint;
  ownerProfit: bigint;
  walletProfit: bigint;
  expectedReturn: bigint;
  params: {
    amountInReserve: bigint;
    hAmountForMint: bigint;
    minimumWethOut: bigint;
    minimumHypedOut: bigint;
    minimumBondOut: bigint;
    minimumReserveOut: bigint;
  };
};

function down(amount: bigint) {
  return amount * (BPS - SLIPPAGE_BPS) / BPS;
}

function profitParts(grossProfit: bigint, protocolFeeBps: number, rewardBps: number) {
  const protocolFee = grossProfit * BigInt(protocolFeeBps) / BPS;
  const executorReward = grossProfit * BigInt(rewardBps) / BPS;
  const ownerProfit = grossProfit - protocolFee - executorReward;
  return { executorReward, ownerProfit, walletProfit: ownerProfit + executorReward };
}

async function quoteExactInput(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
  if (amountIn <= 0n) throw new Error("No route.");
  const client = mintclub.network("base").getPublicClient();
  const quote = await client.readContract({
    address: ONCHAIN_ROUTER,
    abi: ROUTER_ABI,
    functionName: "routeExactInput",
    args: [{ tokenIn, tokenOut, amountSpecified: amountIn }],
    blockTag: "pending",
  });
  if (quote.amountOut <= 0n) throw new Error("No route.");
  return quote.amountOut;
}

async function readBondState(strategy: Strategy) {
  const client = mintclub.network("base").getPublicClient();
  const [steps, currentSupply, maxSupply, decimals, bond] = await Promise.all([
    client.readContract({ address: CHAINS.base.mintClubBond, abi: BOND_ABI, functionName: "getSteps", args: [strategy.hToken], blockTag: "pending" }),
    client.readContract({ address: strategy.hToken, abi: ERC20_META_ABI, functionName: "totalSupply", blockTag: "pending" }),
    client.readContract({ address: CHAINS.base.mintClubBond, abi: BOND_ABI, functionName: "maxSupply", args: [strategy.hToken], blockTag: "pending" }),
    client.readContract({ address: strategy.hToken, abi: ERC20_META_ABI, functionName: "decimals", blockTag: "pending" }),
    client.readContract({ address: CHAINS.base.mintClubBond, abi: BOND_ABI, functionName: "tokenBond", args: [strategy.hToken], blockTag: "pending" }),
  ]);
  if (getAddress(bond[4]) !== strategy.reserveToken) throw new Error("Reserve changed.");
  return { steps, currentSupply, maxSupply, decimals, mintRoyalty: Number(bond[1]) };
}

async function mintThenSell(
  strategy: Strategy,
  budget: bigint,
  bondState: Awaited<ReturnType<typeof readBondState>>,
  protocolFeeBps: number,
  rewardBps: number,
): Promise<Candidate | null> {
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
  const client = mintclub.network("base").getPublicClient();
  const [reserveRequired] = await client.readContract({
    address: CHAINS.base.mintClubBond,
    abi: BOND_ABI,
    functionName: "getReserveForToken",
    args: [strategy.hToken, hAmount],
    blockTag: "pending",
  });
  if (reserveRequired <= 0n || reserveRequired > budget) return null;
  const wethOut = await quoteExactInput(strategy.hToken, CHAINS.base.weth, hAmount);
  const reserveOut = await quoteExactInput(CHAINS.base.weth, strategy.reserveToken, wethOut);
  if (reserveOut <= reserveRequired) return null;
  const parts = profitParts(reserveOut - reserveRequired, protocolFeeBps, rewardBps);
  if (parts.ownerProfit < strategy.minProfitReserve) return null;
  return {
    direction: 0,
    amount: reserveRequired,
    executorReward: parts.executorReward,
    ownerProfit: parts.ownerProfit,
    walletProfit: parts.walletProfit,
    expectedReturn: reserveOut,
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

async function buyThenRedeem(
  strategy: Strategy,
  budget: bigint,
  protocolFeeBps: number,
  rewardBps: number,
): Promise<Candidate | null> {
  const wethOut = await quoteExactInput(strategy.reserveToken, CHAINS.base.weth, budget);
  const hOut = await quoteExactInput(CHAINS.base.weth, strategy.hToken, wethOut);
  const client = mintclub.network("base").getPublicClient();
  const [reserveOut] = await client.readContract({
    address: CHAINS.base.mintClubBond,
    abi: BOND_ABI,
    functionName: "getRefundForTokens",
    args: [strategy.hToken, hOut],
    blockTag: "pending",
  });
  if (reserveOut <= budget) return null;
  const parts = profitParts(reserveOut - budget, protocolFeeBps, rewardBps);
  if (parts.ownerProfit < strategy.minProfitReserve) return null;
  return {
    direction: 1,
    amount: budget,
    executorReward: parts.executorReward,
    ownerProfit: parts.ownerProfit,
    walletProfit: parts.walletProfit,
    expectedReturn: reserveOut,
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

export async function buildDirectArbitrageExecution({
  owner,
  strategyId,
}: {
  owner: Address;
  strategyId: bigint;
}) {
  const executor = getArbitrageExecutorV3("base");
  if (!executor) throw new Error("Arbitrage is not configured.");
  const client = mintclub.network("base").getPublicClient();
  const [rawStrategy, block, protocolFeeBps, rewardBps] = await Promise.all([
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_V3_ABI, functionName: "strategies", args: [strategyId], blockTag: "pending" }),
    client.getBlock({ blockTag: "pending" }),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_V3_ABI, functionName: "protocolFeeBps", blockTag: "pending" }),
    client.readContract({ address: executor, abi: ARBITRAGE_EXECUTOR_V3_ABI, functionName: "executorRewardBps", blockTag: "pending" }),
  ]);
  const [
    strategyOwner,
    hToken,
    reserveToken,
    validUntil,
    active,
    ,
    ,
    maxReserve,
    remainingVolume,
    minProfitReserve,
  ] = rawStrategy;
  const strategy: Strategy = {
    owner: getAddress(strategyOwner),
    hToken: getAddress(hToken),
    reserveToken: getAddress(reserveToken),
    validUntil: BigInt(validUntil),
    active,
    maxReserve,
    remainingVolume,
    minProfitReserve,
  };
  if (strategy.owner !== owner) throw new Error("Not your position.");
  if (!strategy.active || strategy.remainingVolume <= 0n) throw new Error("No active position.");
  if (strategy.validUntil !== 0n && strategy.validUntil < block.timestamp) throw new Error("Position expired.");

  const [balance, allowance] = await Promise.all([
    client.readContract({ address: strategy.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "balanceOf", args: [owner], blockTag: "pending" }),
    client.readContract({ address: strategy.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "allowance", args: [owner, executor], blockTag: "pending" }),
  ]);
  const available = [strategy.maxReserve, strategy.remainingVolume, balance, allowance].reduce((left, right) => left < right ? left : right);
  if (available <= 0n) throw new Error("No available amount.");

  const bondState = await readBondState(strategy);
  const budgets = getArbitrageCurveAmounts(available);
  const candidates = (await Promise.all(budgets.flatMap((budget) => [
    mintThenSell(strategy, budget, bondState, Number(protocolFeeBps), Number(rewardBps)).catch(() => null),
    buyThenRedeem(strategy, budget, Number(protocolFeeBps), Number(rewardBps)).catch(() => null),
  ]))).filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort((left, right) => left.walletProfit > right.walletProfit ? -1 : left.walletProfit < right.walletProfit ? 1 : 0);

  let gasRejected = false;
  for (const candidate of candidates) {
    try {
      const simulation = await client.simulateContract({
        account: owner,
        address: executor,
        abi: ARBITRAGE_EXECUTOR_V3_ABI,
        functionName: "execute",
        args: [strategyId, candidate.direction, candidate.params],
        blockTag: "pending",
      });
      const [gas, gasPrice, rewardWeth] = await Promise.all([
        client.estimateContractGas({ ...simulation.request, account: owner, blockTag: "pending" }),
        client.getGasPrice(),
        quoteExactInput(strategy.reserveToken, CHAINS.base.weth, candidate.executorReward).catch(() => 0n),
      ]);
      const requiredWeth = gas * gasPrice * GAS_MARGIN_BPS / BPS;
      if (rewardWeth < requiredWeth) {
        gasRejected = true;
        continue;
      }
      return {
        executor,
        strategyId: strategyId.toString(),
        direction: candidate.direction,
        params: Object.fromEntries(Object.entries(candidate.params).map(([key, value]) => [key, value.toString()])),
        amountInReserveRaw: candidate.amount.toString(),
        expectedReturnRaw: candidate.expectedReturn.toString(),
        expectedOwnerProfitRaw: candidate.ownerProfit.toString(),
        expectedExecutorRewardRaw: candidate.executorReward.toString(),
        expectedWalletProfitRaw: candidate.walletProfit.toString(),
        simulatedOwnerReturnRaw: simulation.result.toString(),
        gasRaw: gas.toString(),
        gasPriceRaw: gasPrice.toString(),
        rewardWethRaw: rewardWeth.toString(),
        requiredWethRaw: requiredWeth.toString(),
      };
    } catch {
      continue;
    }
  }
  if (gasRejected) throw new Error("Waiting for gas.");
  throw new Error("Not executable now.");
}
