import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

const POSITION_MANAGER_ABI = parseAbi([
  "function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

const POOL_KEY_PARAMETERS = parseAbiParameters(
  "address token0, address token1, uint24 fee",
);

export const UNISWAP_V3_POOL_INIT_CODE_HASH =
  "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54" as const;
export const UNISWAP_V3_FULL_RANGE_TICKS = {
  3_000: { lower: -887_220, upper: 887_220 },
} as const;

function integerSquareRoot(value: bigint) {
  if (value < 0n) throw new Error("Cannot calculate a negative square root.");
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  let next = (estimate + value / estimate) >> 1n;
  while (next < estimate) {
    estimate = next;
    next = (estimate + value / estimate) >> 1n;
  }
  return estimate;
}

export function encodeSqrtPriceX96(amount1: bigint, amount0: bigint) {
  if (amount0 <= 0n || amount1 <= 0n) {
    throw new Error("Initial pool amounts must be greater than zero.");
  }
  const ratioX192 = (amount1 << 192n) / amount0;
  const sqrtPriceX96 = integerSquareRoot(ratioX192);
  if (sqrtPriceX96 <= 0n || sqrtPriceX96 >= 1n << 160n) {
    throw new Error("Initial pool price is outside the Uniswap V3 range.");
  }
  return sqrtPriceX96;
}

export function sortTokenPair(
  tokenA: Address,
  amountA: bigint,
  tokenB: Address,
  amountB: bigint,
) {
  const normalizedA = getAddress(tokenA);
  const normalizedB = getAddress(tokenB);
  if (normalizedA === normalizedB)
    throw new Error("Pool tokens must be different.");
  return BigInt(normalizedA) < BigInt(normalizedB)
    ? {
        token0: normalizedA,
        token1: normalizedB,
        amount0: amountA,
        amount1: amountB,
      }
    : {
        token0: normalizedB,
        token1: normalizedA,
        amount0: amountB,
        amount1: amountA,
      };
}

export function computeUniswapV3PoolAddress({
  factory,
  token0,
  token1,
  fee,
}: {
  factory: Address;
  token0: Address;
  token1: Address;
  fee: number;
}) {
  const salt = keccak256(
    encodeAbiParameters(POOL_KEY_PARAMETERS, [token0, token1, fee]),
  );
  return getCreate2Address({
    from: factory,
    salt,
    bytecodeHash: UNISWAP_V3_POOL_INIT_CODE_HASH,
  });
}

export function prepareFullRangeUniswapV3Position({
  factory,
  tokenA,
  amountA,
  tokenB,
  amountB,
  fee,
  recipient,
  deadline,
  slippageBps,
}: {
  factory: Address;
  tokenA: Address;
  amountA: bigint;
  tokenB: Address;
  amountB: bigint;
  fee: 3_000;
  recipient: Address;
  deadline: number;
  slippageBps: number;
}) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000)
    throw new Error("Enter a valid liquidity slippage limit.");
  const ticks = UNISWAP_V3_FULL_RANGE_TICKS[fee];
  const { token0, token1, amount0, amount1 } = sortTokenPair(
    tokenA,
    amountA,
    tokenB,
    amountB,
  );
  const sqrtPriceX96 = encodeSqrtPriceX96(amount1, amount0);
  const amount0Min = (amount0 * BigInt(10_000 - slippageBps)) / 10_000n;
  const amount1Min = (amount1 * BigInt(10_000 - slippageBps)) / 10_000n;
  const calls: Hex[] = [
    encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, fee, sqrtPriceX96],
    }),
    encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee,
          tickLower: ticks.lower,
          tickUpper: ticks.upper,
          amount0Desired: amount0,
          amount1Desired: amount1,
          amount0Min,
          amount1Min,
          recipient: getAddress(recipient),
          deadline: BigInt(deadline),
        },
      ],
    }),
  ];

  return {
    token0,
    token1,
    amount0,
    amount1,
    amount0Min,
    amount1Min,
    sqrtPriceX96,
    tickLower: ticks.lower,
    tickUpper: ticks.upper,
    pool: computeUniswapV3PoolAddress({ factory, token0, token1, fee }),
    calldata: encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "multicall",
      args: [calls],
    }),
    value: 0n,
  };
}
