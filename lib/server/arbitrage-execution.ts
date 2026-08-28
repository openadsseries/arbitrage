import "server-only";

import { BOND_ABI, binaryReverseMint, mintclub } from "@mint.club/v2-sdk";
import { getAddress, parseAbi, type Address, type PublicClient, type Transport } from "viem";
import { base } from "viem/chains";
import { estimateContractTotalFee } from "viem/op-stack";
import {
  ARBITRAGE_EXECUTOR_V3_ABI,
  ARBITRAGE_EXECUTOR_V4_ABI,
  ERC20_PERMISSION_ABI,
  getArbitrageExecutorV3,
  getArbitrageExecutorV4,
  type ArbitrageExecutionReasonCode,
  type DirectArbitrageExecutionQuote,
} from "@/lib/arbitrage";
import {
  calculateV3ProfitSplit,
  estimateV3ExecutorRewardFromOwnerProfit,
  requiredGasCover,
  rewardCoversExecutionFee,
} from "../arbitrage-economics.mjs";
import { maximizeExecutable } from "../arbitrage-optimizer.mjs";
import { CHAINS } from "@/lib/chains";
import { readTokenMarketPrice } from "@/lib/server/gecko-market";

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
  net: bigint;
  ownerProfit: bigint;
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
type ArbitrageClient = Pick<PublicClient, "estimateContractGas" | "getBlock" | "getGasPrice" | "readContract" | "simulateContract">;
export type DirectArbitrageExecutionStatus =
  | { status: "ready"; code: "ready"; execution: DirectArbitrageExecutionQuote }
  | { status: "waiting-gas"; code: "fees-higher-than-profit"; execution: DirectArbitrageExecutionQuote; error: string }
  | { status: "none"; code: Exclude<ArbitrageExecutionReasonCode, "ready" | "fees-higher-than-profit">; error: string };

function down(amount: bigint) {
  return amount * (BPS - SLIPPAGE_BPS) / BPS;
}

async function quoteExactInput(client: ArbitrageClient, tokenIn: Address, tokenOut: Address, amountIn: bigint) {
  if (amountIn <= 0n) throw new Error("No route.");
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

async function addUsdPrices(execution: DirectArbitrageExecutionQuote, reserveToken: Address) {
  const [reservePrice, wethPrice] = await Promise.all([
    readTokenMarketPrice("base", reserveToken),
    readTokenMarketPrice("base", CHAINS.base.weth),
  ]);
  return {
    ...execution,
    reserveUsd: reservePrice?.usd ?? null,
    wethUsd: wethPrice?.usd ?? null,
  };
}

async function readBondState(strategy: Strategy, client: ArbitrageClient) {
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
  client: ArbitrageClient,
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
  const [reserveRequired] = await client.readContract({
    address: CHAINS.base.mintClubBond,
    abi: BOND_ABI,
    functionName: "getReserveForToken",
    args: [strategy.hToken, hAmount],
    blockTag: "pending",
  });
  if (reserveRequired <= 0n || reserveRequired > budget) return null;
  const wethOut = await quoteExactInput(client, strategy.hToken, CHAINS.base.weth, hAmount);
  const reserveOut = await quoteExactInput(client, CHAINS.base.weth, strategy.reserveToken, wethOut);
  const parts = calculateV3ProfitSplit(
    reserveOut - reserveRequired,
    protocolFeeBps,
    rewardBps,
  );
  return {
    direction: 0,
    amount: reserveRequired,
    net: parts.ownerProfit,
    ownerProfit: parts.ownerProfit,
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
  client: ArbitrageClient,
  strategy: Strategy,
  budget: bigint,
  protocolFeeBps: number,
  rewardBps: number,
): Promise<Candidate | null> {
  const wethOut = await quoteExactInput(client, strategy.reserveToken, CHAINS.base.weth, budget);
  const hOut = await quoteExactInput(client, CHAINS.base.weth, strategy.hToken, wethOut);
  const [reserveOut] = await client.readContract({
    address: CHAINS.base.mintClubBond,
    abi: BOND_ABI,
    functionName: "getRefundForTokens",
    args: [strategy.hToken, hOut],
    blockTag: "pending",
  });
  const parts = calculateV3ProfitSplit(
    reserveOut - budget,
    protocolFeeBps,
    rewardBps,
  );
  return {
    direction: 1,
    amount: budget,
    net: parts.ownerProfit,
    ownerProfit: parts.ownerProfit,
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
  executionAccount = owner,
  client = mintclub.network("base").getPublicClient() as unknown as ArbitrageClient,
}: {
  owner: Address;
  strategyId: bigint;
  executionAccount?: Address;
  client?: ArbitrageClient;
}) {
  const status = await readDirectArbitrageExecutionStatus({ owner, strategyId, executionAccount, client });
  if (status.status === "ready") return status.execution;
  throw new Error(status.error);
}

export async function readDirectArbitrageExecutionStatus({
  owner,
  strategyId,
  executionAccount = owner,
  client = mintclub.network("base").getPublicClient() as unknown as ArbitrageClient,
}: {
  owner: Address;
  strategyId: bigint;
  executionAccount?: Address;
  client?: ArbitrageClient;
}): Promise<DirectArbitrageExecutionStatus> {
  const executor = getArbitrageExecutorV3("base");
  if (!executor) return { status: "none", code: "not-configured", error: "Arbitrage is not configured." };
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
  if (strategy.owner !== owner) return { status: "none", code: "not-owner", error: "Not your position." };
  if (!strategy.active || strategy.remainingVolume <= 0n) return { status: "none", code: "inactive", error: "No active position." };
  if (strategy.validUntil !== 0n && strategy.validUntil < block.timestamp) return { status: "none", code: "expired", error: "Position expired." };

  const [balance, allowance] = await Promise.all([
    client.readContract({ address: strategy.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "balanceOf", args: [owner], blockTag: "pending" }),
    client.readContract({ address: strategy.reserveToken, abi: ERC20_PERMISSION_ABI, functionName: "allowance", args: [owner, executor], blockTag: "pending" }),
  ]);
  const available = [strategy.maxReserve, strategy.remainingVolume, balance, allowance].reduce((left, right) => left < right ? left : right);
  if (available <= 0n) return { status: "none", code: "no-permission", error: "No available amount." };

  const bondState = await readBondState(strategy, client);
  const [mintCandidate, redeemCandidate] = await Promise.all([
    maximizeExecutable(
      available,
      (budget) => mintThenSell(client, strategy, budget, bondState, Number(protocolFeeBps), Number(rewardBps)),
    ),
    maximizeExecutable(
      available,
      (budget) => buyThenRedeem(client, strategy, budget, Number(protocolFeeBps), Number(rewardBps)),
    ),
  ]);
  const candidates = [mintCandidate, redeemCandidate]
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .filter((candidate) => candidate.ownerProfit > 0n && candidate.ownerProfit >= strategy.minProfitReserve)
    .sort((left, right) => left.ownerProfit > right.ownerProfit ? -1 : left.ownerProfit < right.ownerProfit ? 1 : 0);

  let gasRejected: DirectArbitrageExecutionQuote | null = null;
  for (const candidate of candidates) {
    try {
      const simulation = await client.simulateContract({
        account: executionAccount,
        address: executor,
        abi: ARBITRAGE_EXECUTOR_V3_ABI,
        functionName: "execute",
        args: [strategyId, candidate.direction, candidate.params],
        blockTag: "pending",
      });
      const [gas, gasPrice, totalFee] = await Promise.all([
        client.estimateContractGas({ ...simulation.request, account: executionAccount, blockTag: "pending" }),
        client.getGasPrice(),
        estimateContractTotalFee(client as PublicClient<Transport, typeof base>, {
          account: executionAccount,
          address: executor,
          abi: ARBITRAGE_EXECUTOR_V3_ABI,
          functionName: "execute",
          args: [strategyId, candidate.direction, candidate.params],
        }),
      ]);
      const simulatedOwnerProfit = simulation.result > candidate.amount
        ? simulation.result - candidate.amount
        : 0n;
      if (simulatedOwnerProfit < strategy.minProfitReserve) continue;
      const simulatedExecutorReward = estimateV3ExecutorRewardFromOwnerProfit(
        simulatedOwnerProfit,
        protocolFeeBps,
        rewardBps,
      );
      const simulatedRewardWeth = await quoteExactInput(
        client,
        strategy.reserveToken,
        CHAINS.base.weth,
        simulatedExecutorReward,
      ).catch(() => 0n);
      const requiredWeth = requiredGasCover(totalFee, GAS_MARGIN_BPS);
      const execution: DirectArbitrageExecutionQuote = {
        version: "v3",
        executor,
        strategyId: strategyId.toString(),
        direction: candidate.direction,
        params: Object.fromEntries(Object.entries(candidate.params).map(([key, value]) => [key, value.toString()])) as DirectArbitrageExecutionQuote["params"],
        amountInReserveRaw: candidate.amount.toString(),
        expectedReturnRaw: candidate.expectedReturn.toString(),
        expectedOwnerProfitRaw: simulatedOwnerProfit.toString(),
        expectedExecutorRewardRaw: simulatedExecutorReward.toString(),
        expectedWalletProfitRaw: (simulatedOwnerProfit + simulatedExecutorReward).toString(),
        simulatedOwnerReturnRaw: simulation.result.toString(),
        gasRaw: gas.toString(),
        gasPriceRaw: gasPrice.toString(),
        totalFeeWethRaw: totalFee.toString(),
        rewardWethRaw: simulatedRewardWeth.toString(),
        requiredWethRaw: requiredWeth.toString(),
      };
      if (!rewardCoversExecutionFee(simulatedRewardWeth, totalFee, GAS_MARGIN_BPS)) {
        gasRejected ??= execution;
        continue;
      }
      return { status: "ready", code: "ready", execution: await addUsdPrices(execution, strategy.reserveToken) };
    } catch {
      continue;
    }
  }
  if (gasRejected) {
    return {
      status: "waiting-gas",
      code: "fees-higher-than-profit",
      execution: await addUsdPrices(gasRejected, strategy.reserveToken),
      error: "Fees are higher than profit.",
    };
  }
  return { status: "none", code: "no-profitable-route", error: "No profitable route." };
}

type StrategyV4 = Strategy & {
  minProfitBps: bigint;
  maxFeeReimbursementReserve: bigint;
};

function requiredOwnerProfitV4(strategy: StrategyV4, amountSpent: bigint) {
  const percentageFloor = (amountSpent * strategy.minProfitBps) / BPS;
  return strategy.minProfitReserve > percentageFloor
    ? strategy.minProfitReserve
    : percentageFloor;
}

function v4Params(candidate: Candidate, feeReimbursementWei: bigint) {
  return {
    amountInReserve: candidate.params.amountInReserve,
    hAmountForMint: candidate.params.hAmountForMint,
    minimumHypedOut: candidate.params.minimumHypedOut,
    minimumBondOut: candidate.params.minimumBondOut,
    minimumReserveOut: candidate.params.minimumReserveOut,
    feeReimbursementWei,
  } as const;
}

export async function readDirectArbitrageExecutionStatusV4({
  owner,
  strategyId,
  executionAccount = owner,
  client = mintclub.network("base").getPublicClient() as unknown as ArbitrageClient,
}: {
  owner: Address;
  strategyId: bigint;
  executionAccount?: Address;
  client?: ArbitrageClient;
}): Promise<DirectArbitrageExecutionStatus> {
  const executor = getArbitrageExecutorV4("base");
  if (!executor) {
    return {
      status: "none",
      code: "not-configured",
      error: "Arbitrage is not configured.",
    };
  }

  const [rawStrategy, block, rewardBps] = await Promise.all([
    client.readContract({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V4_ABI,
      functionName: "strategies",
      args: [strategyId],
      blockTag: "pending",
    }),
    client.getBlock({ blockTag: "pending" }),
    client.readContract({
      address: executor,
      abi: ARBITRAGE_EXECUTOR_V4_ABI,
      functionName: "executorProfitShareBps",
      blockTag: "pending",
    }),
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
    maxFeeReimbursementReserve,
    minProfitBps,
  ] = rawStrategy;
  const strategy: StrategyV4 = {
    owner: getAddress(strategyOwner),
    hToken: getAddress(hToken),
    reserveToken: getAddress(reserveToken),
    validUntil: BigInt(validUntil),
    active,
    maxReserve,
    remainingVolume,
    minProfitReserve,
    minProfitBps: BigInt(minProfitBps),
    maxFeeReimbursementReserve,
  };
  if (strategy.owner !== owner) {
    return { status: "none", code: "not-owner", error: "Not your position." };
  }
  if (!strategy.active || strategy.remainingVolume <= 0n) {
    return { status: "none", code: "inactive", error: "No active position." };
  }
  if (strategy.validUntil !== 0n && strategy.validUntil < block.timestamp) {
    return { status: "none", code: "expired", error: "Position expired." };
  }

  const [balance, allowance] = await Promise.all([
    client.readContract({
      address: strategy.reserveToken,
      abi: ERC20_PERMISSION_ABI,
      functionName: "balanceOf",
      args: [owner],
      blockTag: "pending",
    }),
    client.readContract({
      address: strategy.reserveToken,
      abi: ERC20_PERMISSION_ABI,
      functionName: "allowance",
      args: [owner, executor],
      blockTag: "pending",
    }),
  ]);
  const available = [
    strategy.maxReserve,
    strategy.remainingVolume,
    balance,
    allowance,
  ].reduce((left, right) => (left < right ? left : right));
  if (available <= 0n) {
    return {
      status: "none",
      code: "no-permission",
      error: "No available amount.",
    };
  }

  const bondState = await readBondState(strategy, client);
  const [mintCandidate, redeemCandidate] = await Promise.all([
    maximizeExecutable(available, (budget) =>
      mintThenSell(
        client,
        strategy,
        budget,
        bondState,
        0,
        Number(rewardBps),
      ),
    ),
    maximizeExecutable(available, (budget) =>
      buyThenRedeem(client, strategy, budget, 0, Number(rewardBps)),
    ),
  ]);
  const candidates = [mintCandidate, redeemCandidate]
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .filter(
      (candidate) =>
        candidate.expectedReturn > candidate.amount &&
        candidate.ownerProfit >=
          requiredOwnerProfitV4(strategy, candidate.amount),
    )
    .sort((left, right) =>
      left.ownerProfit > right.ownerProfit
        ? -1
        : left.ownerProfit < right.ownerProfit
          ? 1
          : 0,
    );

  let feeRejected: DirectArbitrageExecutionQuote | null = null;
  for (const candidate of candidates) {
    try {
      const zeroFeeParams = v4Params(candidate, 0n);
      await client.simulateContract({
        account: executionAccount,
        address: executor,
        abi: ARBITRAGE_EXECUTOR_V4_ABI,
        functionName: "execute",
        args: [strategyId, candidate.direction, zeroFeeParams],
        blockTag: "pending",
      });
      const firstFee = await estimateContractTotalFee(
        client as PublicClient<Transport, typeof base>,
        {
          account: executionAccount,
          address: executor,
          abi: ARBITRAGE_EXECUTOR_V4_ABI,
          functionName: "execute",
          args: [strategyId, candidate.direction, zeroFeeParams],
        },
      );
      const initialFeeParams = v4Params(candidate, firstFee);
      const claimedFee = await estimateContractTotalFee(
        client as PublicClient<Transport, typeof base>,
        {
          account: executionAccount,
          address: executor,
          abi: ARBITRAGE_EXECUTOR_V4_ABI,
          functionName: "execute",
          args: [strategyId, candidate.direction, initialFeeParams],
        },
      );
      const feeParams = v4Params(candidate, claimedFee);
      const [gasReimbursementReserve, gasPrice] = await Promise.all([
        client.readContract({
          address: executor,
          abi: ARBITRAGE_EXECUTOR_V4_ABI,
          functionName: "quoteGasCostInReserve",
          args: [strategy.reserveToken, claimedFee],
          blockTag: "pending",
        }),
        client.getGasPrice(),
      ]);
      const grossProfit = candidate.expectedReturn - candidate.amount;
      const profitAfterGas =
        grossProfit > gasReimbursementReserve
          ? grossProfit - gasReimbursementReserve
          : 0n;
      const executorIncentive =
        (profitAfterGas * BigInt(rewardBps)) / BPS;
      const estimatedOwnerProfit = profitAfterGas - executorIncentive;
      const requiredOwnerProfit = requiredOwnerProfitV4(
        strategy,
        candidate.amount,
      );
      if (
        gasReimbursementReserve > strategy.maxFeeReimbursementReserve ||
        estimatedOwnerProfit < requiredOwnerProfit
      ) {
        feeRejected ??= {
          version: "v4",
          executor,
          strategyId: strategyId.toString(),
          direction: candidate.direction,
          params: {
            amountInReserve: feeParams.amountInReserve.toString(),
            hAmountForMint: feeParams.hAmountForMint.toString(),
            minimumWethOut: candidate.params.minimumWethOut.toString(),
            minimumHypedOut: feeParams.minimumHypedOut.toString(),
            minimumBondOut: feeParams.minimumBondOut.toString(),
            minimumReserveOut: feeParams.minimumReserveOut.toString(),
            feeReimbursementWei: feeParams.feeReimbursementWei.toString(),
          },
          amountInReserveRaw: candidate.amount.toString(),
          expectedReturnRaw: candidate.expectedReturn.toString(),
          expectedOwnerProfitRaw: estimatedOwnerProfit.toString(),
          expectedExecutorRewardRaw: (
            gasReimbursementReserve + executorIncentive
          ).toString(),
          expectedWalletProfitRaw: estimatedOwnerProfit.toString(),
          simulatedOwnerReturnRaw: (
            candidate.amount + estimatedOwnerProfit
          ).toString(),
          gasRaw: "0",
          gasPriceRaw: gasPrice.toString(),
          totalFeeWethRaw: claimedFee.toString(),
          rewardWethRaw: claimedFee.toString(),
          requiredWethRaw: requiredGasCover(
            claimedFee,
            GAS_MARGIN_BPS,
          ).toString(),
        };
        continue;
      }
      const simulation = await client.simulateContract({
        account: executionAccount,
        address: executor,
        abi: ARBITRAGE_EXECUTOR_V4_ABI,
        functionName: "execute",
        args: [strategyId, candidate.direction, feeParams],
        blockTag: "pending",
      });
      const [gas, totalFee] = await Promise.all([
          client.estimateContractGas({
            ...simulation.request,
            account: executionAccount,
            blockTag: "pending",
          }),
          estimateContractTotalFee(
            client as PublicClient<Transport, typeof base>,
            {
              account: executionAccount,
              address: executor,
              abi: ARBITRAGE_EXECUTOR_V4_ABI,
              functionName: "execute",
              args: [strategyId, candidate.direction, feeParams],
            },
          ),
        ]);
      const ownerReturn = simulation.result;
      const ownerProfit =
        ownerReturn > candidate.amount ? ownerReturn - candidate.amount : 0n;
      const executorReward =
        grossProfit > ownerProfit ? grossProfit - ownerProfit : 0n;
      const execution: DirectArbitrageExecutionQuote = {
        version: "v4",
        executor,
        strategyId: strategyId.toString(),
        direction: candidate.direction,
        params: {
          amountInReserve: feeParams.amountInReserve.toString(),
          hAmountForMint: feeParams.hAmountForMint.toString(),
          minimumWethOut: candidate.params.minimumWethOut.toString(),
          minimumHypedOut: feeParams.minimumHypedOut.toString(),
          minimumBondOut: feeParams.minimumBondOut.toString(),
          minimumReserveOut: feeParams.minimumReserveOut.toString(),
          feeReimbursementWei: feeParams.feeReimbursementWei.toString(),
        },
        amountInReserveRaw: candidate.amount.toString(),
        expectedReturnRaw: candidate.expectedReturn.toString(),
        expectedOwnerProfitRaw: ownerProfit.toString(),
        expectedExecutorRewardRaw: executorReward.toString(),
        expectedWalletProfitRaw: ownerProfit.toString(),
        simulatedOwnerReturnRaw: ownerReturn.toString(),
        gasRaw: gas.toString(),
        gasPriceRaw: gasPrice.toString(),
        totalFeeWethRaw: totalFee.toString(),
        rewardWethRaw: claimedFee.toString(),
        requiredWethRaw: requiredGasCover(totalFee, GAS_MARGIN_BPS).toString(),
      };
      return {
        status: "ready",
        code: "ready",
        execution: await addUsdPrices(execution, strategy.reserveToken),
      };
    } catch {
      continue;
    }
  }
  if (feeRejected) {
    return {
      status: "waiting-gas",
      code: "fees-higher-than-profit",
      execution: await addUsdPrices(feeRejected, strategy.reserveToken),
      error: "Fees are higher than profit.",
    };
  }
  return {
    status: "none",
    code: "no-profitable-route",
    error: "No profitable route.",
  };
}
