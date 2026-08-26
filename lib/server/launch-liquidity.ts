import "server-only";

import { mintclub } from "@mint.club/v2-sdk";
import { Percent, Token } from "@uniswap/sdk-core";
import {
  encodeSqrtRatioX96,
  nearestUsableTick,
  NonfungiblePositionManager,
  Pool,
  Position,
  TickMath,
} from "@uniswap/v3-sdk";
import {
  getAddress,
  isAddressEqual,
  parseAbi,
  zeroAddress,
  type Address,
} from "viem";
import { CHAINS, type ChainKey } from "@/lib/chains";
import { discoverDirectUniswapMarket } from "@/lib/server/uniswap-market";
import type { LiquidityPreparation } from "@/lib/types";
import type { ArbitragePreview } from "@/lib/types";

const FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

const POOL_ABI = parseAbi(["function liquidity() view returns (uint128)"]);

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

const FEE_TIERS = [500, 3000, 10_000, 100] as const;
const NEW_POOL_FEE = 3000;
const POSITION_SLIPPAGE_BPS = 100;
const DEADLINE_SECONDS = 10 * 60;

type DirectQuote = {
  quoteToken: Address;
  quoteSymbol: string;
  quoteDecimals: number;
  fee: number;
  pool: Address | null;
  amountOut: bigint;
};

function network(chain: ChainKey) {
  return mintclub.network(chain);
}

async function quoteExactInput(
  chain: ChainKey,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  fee: number,
) {
  const client = network(chain).getPublicClient();
  const simulation = await client.simulateContract({
    address: CHAINS[chain].quoter,
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  return simulation.result[0];
}

async function quoteExactOutput(
  chain: ChainKey,
  tokenIn: Address,
  tokenOut: Address,
  amountOut: bigint,
  fee: number,
) {
  const client = network(chain).getPublicClient();
  const simulation = await client.simulateContract({
    address: CHAINS[chain].quoter,
    abi: QUOTER_ABI,
    functionName: "quoteExactOutputSingle",
    args: [
      { tokenIn, tokenOut, amount: amountOut, fee, sqrtPriceLimitX96: 0n },
    ],
  });
  return simulation.result[0];
}

async function findActivePool(chain: ChainKey, token: Address) {
  const capability = CHAINS[chain];
  const client = network(chain).getPublicClient();
  const candidates = capability.quoteAssets.flatMap((quote) =>
    FEE_TIERS.map((fee) => ({ quote, fee })),
  );
  const pools = await client.multicall({
    allowFailure: true,
    contracts: candidates.map(({ quote, fee }) => ({
      address: capability.uniswapV3Factory,
      abi: FACTORY_ABI,
      functionName: "getPool" as const,
      args: [token, quote.address, fee] as const,
    })),
  });
  const deployed = pools.flatMap((result, index) =>
    result.status === "success" && result.result !== zeroAddress
      ? [{ pool: getAddress(result.result), ...candidates[index] }]
      : [],
  );
  const liquidities = await client.multicall({
    allowFailure: true,
    contracts: deployed.map(({ pool }) => ({
      address: pool,
      abi: POOL_ABI,
      functionName: "liquidity" as const,
    })),
  });
  const best = deployed
    .flatMap((candidate, index) => {
      const result = liquidities[index];
      return result.status === "success" && result.result > 0n
        ? [{ ...candidate, liquidity: result.result }]
        : [];
    })
    .sort((left, right) =>
      left.liquidity > right.liquidity
        ? -1
        : left.liquidity < right.liquidity
          ? 1
          : 0,
    )[0];
  if (!best)
    throw new Error(
      "No active h-token liquidity was found on a supported quote asset.",
    );
  return best;
}

async function findSourcePool(
  chain: ChainKey,
  reserveToken: Address,
  quoteToken: Address,
) {
  if (isAddressEqual(reserveToken, quoteToken)) return { pool: null, fee: 0 };
  const client = network(chain).getPublicClient();
  const results = await Promise.all(
    FEE_TIERS.map(async (fee) => {
      const pool = await client.readContract({
        address: CHAINS[chain].uniswapV3Factory,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [reserveToken, quoteToken, fee],
      });
      if (pool === zeroAddress) return null;
      const liquidity = await client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "liquidity",
      });
      return liquidity > 0n ? { pool: getAddress(pool), fee, liquidity } : null;
    }),
  );
  const best = results
    .filter((result): result is NonNullable<typeof result> => result !== null)
    .sort((left, right) =>
      left.liquidity > right.liquidity
        ? -1
        : left.liquidity < right.liquidity
          ? 1
          : 0,
    )[0];
  if (best) return { pool: best.pool, fee: best.fee };
  throw new Error(
    "The h-token pool exists, but no matching OG market was found against the same quote asset.",
  );
}

async function findExecutableQuote(
  chain: ChainKey,
  reserveToken: Address,
  amountIn: bigint,
): Promise<DirectQuote> {
  const capability = CHAINS[chain];
  const client = network(chain).getPublicClient();

  for (const quote of capability.quoteAssets) {
    if (isAddressEqual(reserveToken, quote.address)) {
      return {
        quoteToken: quote.address,
        quoteSymbol: quote.symbol,
        quoteDecimals: quote.decimals,
        fee: 0,
        pool: null,
        amountOut: amountIn,
      };
    }
    for (const fee of FEE_TIERS) {
      const pool = await client.readContract({
        address: capability.uniswapV3Factory,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [reserveToken, quote.address, fee],
      });
      if (pool === zeroAddress) continue;
      const liquidity = await client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "liquidity",
      });
      if (liquidity === 0n) continue;
      try {
        const amountOut = await quoteExactInput(
          chain,
          reserveToken,
          quote.address,
          amountIn,
          fee,
        );
        if (amountOut > 0n) {
          return {
            quoteToken: quote.address,
            quoteSymbol: quote.symbol,
            quoteDecimals: quote.decimals,
            fee,
            pool: getAddress(pool),
            amountOut,
          };
        }
      } catch {
        // Try the next canonical quote asset or fee tier.
      }
    }
  }
  throw new Error(
    "No executable direct OG market was found against a supported quote asset. A real OG market is required before creating the connected h-token market.",
  );
}

export async function prepareLaunchLiquidity({
  chain,
  owner,
  hypedToken,
  hypedAmount,
  reserveReference,
}: {
  chain: ChainKey;
  owner: Address;
  hypedToken: Address;
  hypedAmount: bigint;
  reserveReference?: bigint;
}): Promise<LiquidityPreparation> {
  if (hypedAmount <= 0n)
    throw new Error("Enter an h-token amount greater than zero.");
  if (owner === zeroAddress)
    throw new Error("Connect a wallet before preparing liquidity.");
  if (chain !== "base") {
    throw new Error(
      "Connected pool creation is enabled on Base first while Robinhood remains read-only beta.",
    );
  }

  const capability = CHAINS[chain];
  const client = network(chain).getPublicClient();
  const hToken = network(chain).token(hypedToken);
  if (!(await hToken.exists()))
    throw new Error("The h-token was not found in Mint Club.");

  const [hypedSymbol, hypedDecimals, bond, estimation, redemption, readBlock] =
    await Promise.all([
      hToken.getSymbol(),
      hToken.getDecimals(),
      hToken.getTokenBond(),
      hToken.getBuyEstimation(hypedAmount),
      hToken.getSellEstimation(hypedAmount).catch(() => null),
      client.getBlockNumber(),
    ]);
  const reserveToken = getAddress(bond.reserveToken);
  const reserve = network(chain).token(reserveToken);
  const [reserveSymbol, reserveDecimals] = await Promise.all([
    reserve.getSymbol(),
    reserve.getDecimals(),
  ]);

  if (reserveReference !== undefined) {
    const lowerBound = redemption ? (redemption[0] * 99n) / 100n : 0n;
    const upperBound = (estimation[0] * 101n) / 100n + 1n;
    if (reserveReference < lowerBound || reserveReference > upperBound) {
      throw new Error(
        "The saved reserve amount no longer matches the Mint Club curve. Check the mint again.",
      );
    }
  }
  const reserveRequired = reserveReference ?? estimation[0];
  if (reserveRequired <= 0n)
    throw new Error("Mint Club returned a zero reserve requirement.");
  const directMarketCheck = await discoverDirectUniswapMarket(
    chain,
    hypedToken,
    hypedDecimals,
  );
  if (directMarketCheck.status === "unavailable") {
    throw new Error(
      "Existing Uniswap liquidity could not be verified. Try again before creating a pool.",
    );
  }
  if (directMarketCheck.market) {
    throw new Error(
      `${hypedSymbol} already has an active Uniswap ${directMarketCheck.market.protocol} ${directMarketCheck.market.quoteSymbol} market. Use the existing market instead of creating another pool.`,
    );
  }
  const directQuote = await findExecutableQuote(
    chain,
    reserveToken,
    reserveRequired,
  );

  const existingPool = await client.readContract({
    address: capability.uniswapV3Factory,
    abi: FACTORY_ABI,
    functionName: "getPool",
    args: [hypedToken, directQuote.quoteToken, NEW_POOL_FEE],
  });
  if (existingPool !== zeroAddress) {
    throw new Error(
      `A ${hypedSymbol} / ${directQuote.quoteSymbol} pool already exists at the 0.30% tier. Verify and use the existing pool instead of creating another one.`,
    );
  }

  const hSdkToken = new Token(
    capability.id,
    hypedToken,
    hypedDecimals,
    hypedSymbol,
  );
  const quoteSdkToken = new Token(
    capability.id,
    directQuote.quoteToken,
    directQuote.quoteDecimals,
    directQuote.quoteSymbol,
  );
  const token0 = hSdkToken.sortsBefore(quoteSdkToken)
    ? hSdkToken
    : quoteSdkToken;
  const token1 = hSdkToken.sortsBefore(quoteSdkToken)
    ? quoteSdkToken
    : hSdkToken;
  const amount0 = token0.equals(hSdkToken)
    ? hypedAmount
    : directQuote.amountOut;
  const amount1 = token1.equals(hSdkToken)
    ? hypedAmount
    : directQuote.amountOut;
  const sqrtPriceX96 = encodeSqrtRatioX96(
    amount1.toString(),
    amount0.toString(),
  );
  const currentTick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
  const poolModel = new Pool(
    token0,
    token1,
    NEW_POOL_FEE,
    sqrtPriceX96.toString(),
    "0",
    currentTick,
  );
  const position = Position.fromAmounts({
    pool: poolModel,
    tickLower: nearestUsableTick(TickMath.MIN_TICK, poolModel.tickSpacing),
    tickUpper: nearestUsableTick(TickMath.MAX_TICK, poolModel.tickSpacing),
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    useFullPrecision: true,
  });
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;
  const method = NonfungiblePositionManager.addCallParameters(position, {
    recipient: owner,
    deadline,
    slippageTolerance: new Percent(POSITION_SLIPPAGE_BPS, 10_000),
    createPool: true,
  });
  const mintAmounts = position.mintAmounts;
  const positionAmountHyped = token0.equals(hSdkToken)
    ? BigInt(mintAmounts.amount0.toString())
    : BigInt(mintAmounts.amount1.toString());
  const positionAmountQuote = token0.equals(quoteSdkToken)
    ? BigInt(mintAmounts.amount0.toString())
    : BigInt(mintAmounts.amount1.toString());
  const pool = Pool.getAddress(
    token0,
    token1,
    NEW_POOL_FEE,
    undefined,
    capability.uniswapV3Factory,
  );

  return {
    chain,
    readBlock: readBlock.toString(),
    expiresAt: new Date(deadline * 1000).toISOString(),
    owner,
    hypedToken,
    hypedSymbol,
    hypedDecimals,
    reserveToken,
    reserveSymbol,
    reserveDecimals,
    hypedAmountRaw: hypedAmount.toString(),
    reserveRequiredRaw: reserveRequired.toString(),
    maxReserveAmountRaw: ((estimation[0] * 101n) / 100n + 1n).toString(),
    quoteToken: directQuote.quoteToken,
    quoteSymbol: directQuote.quoteSymbol,
    quoteDecimals: directQuote.quoteDecimals,
    quoteAmountRaw: directQuote.amountOut.toString(),
    sourcePool: directQuote.pool,
    sourcePoolFee: directQuote.fee,
    pool: getAddress(pool),
    poolFee: NEW_POOL_FEE,
    positionManager: capability.nonfungiblePositionManager,
    positionAmountHypedRaw: positionAmountHyped.toString(),
    positionAmountQuoteRaw: positionAmountQuote.toString(),
    calldata: method.calldata as `0x${string}`,
    valueRaw: method.value,
  };
}

export async function previewArbitrageRoutes({
  chain,
  hypedToken,
  hypedAmount,
}: {
  chain: ChainKey;
  hypedToken: Address;
  hypedAmount: bigint;
}): Promise<ArbitragePreview> {
  if (hypedAmount <= 0n)
    throw new Error("Enter an h-token amount greater than zero.");
  const client = network(chain).getPublicClient();
  const hToken = network(chain).token(hypedToken);
  if (!(await hToken.exists()))
    throw new Error("The h-token was not found in Mint Club.");
  const [
    hypedSymbol,
    hypedDecimals,
    bond,
    mintEstimation,
    redeemEstimation,
    readBlock,
    hPool,
  ] = await Promise.all([
    hToken.getSymbol(),
    hToken.getDecimals(),
    hToken.getTokenBond(),
    hToken.getBuyEstimation(hypedAmount),
    hToken.getSellEstimation(hypedAmount),
    client.getBlockNumber(),
    findActivePool(chain, hypedToken),
  ]);
  const reserveToken = getAddress(bond.reserveToken);
  const reserve = network(chain).token(reserveToken);
  const [reserveSymbol, reserveDecimals, sourcePool] = await Promise.all([
    reserve.getSymbol(),
    reserve.getDecimals(),
    findSourcePool(chain, reserveToken, hPool.quote.address),
  ]);
  const reserveForMint = mintEstimation[0];
  const reserveFromRedeem = redeemEstimation[0];
  const mintQuoteIn = sourcePool.pool
    ? await quoteExactOutput(
        chain,
        hPool.quote.address,
        reserveToken,
        reserveForMint,
        sourcePool.fee,
      )
    : reserveForMint;
  const mintQuoteOut = await quoteExactInput(
    chain,
    hypedToken,
    hPool.quote.address,
    hypedAmount,
    hPool.fee,
  );
  const redeemQuoteIn = await quoteExactOutput(
    chain,
    hPool.quote.address,
    hypedToken,
    hypedAmount,
    hPool.fee,
  );
  const redeemQuoteOut = sourcePool.pool
    ? await quoteExactInput(
        chain,
        reserveToken,
        hPool.quote.address,
        reserveFromRedeem,
        sourcePool.fee,
      )
    : reserveFromRedeem;
  const mintDifference = mintQuoteOut - mintQuoteIn;
  const redeemDifference = redeemQuoteOut - redeemQuoteIn;
  return {
    chain,
    readBlock: readBlock.toString(),
    hypedToken,
    hypedSymbol,
    hypedDecimals,
    hypedAmountRaw: hypedAmount.toString(),
    reserveToken,
    reserveSymbol,
    reserveDecimals,
    quoteToken: hPool.quote.address,
    quoteSymbol: hPool.quote.symbol,
    quoteDecimals: hPool.quote.decimals,
    mintRoute: {
      quoteInRaw: mintQuoteIn.toString(),
      quoteOutRaw: mintQuoteOut.toString(),
      differenceRaw: mintDifference.toString(),
      profitableBeforeGas: mintDifference > 0n,
    },
    redeemRoute: {
      quoteInRaw: redeemQuoteIn.toString(),
      quoteOutRaw: redeemQuoteOut.toString(),
      differenceRaw: redeemDifference.toString(),
      profitableBeforeGas: redeemDifference > 0n,
    },
  };
}
