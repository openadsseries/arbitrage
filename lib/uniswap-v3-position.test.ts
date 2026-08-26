import { decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import {
  computeUniswapV3PoolAddress,
  encodeSqrtPriceX96,
  prepareFullRangeUniswapV3Position,
} from "./uniswap-v3-position";

const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x4200000000000000000000000000000000000006";
const OWNER = "0x895Af8672d72528F168A239a16c4c07eeE4890C0";
const POSITION_MANAGER_ABI = parseAbi([
  "function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

describe("Uniswap V3 position preparation", () => {
  it("matches the canonical SDK pool address and initial price", () => {
    const amountA = 10_000_000_000_000_000_000_000n;
    const amountB = 1_234_567_890_123_456_789n;
    const preparation = prepareFullRangeUniswapV3Position({
      factory: FACTORY,
      tokenA: TOKEN_A,
      amountA,
      tokenB: TOKEN_B,
      amountB,
      fee: 3_000,
      recipient: OWNER,
      deadline: 1_800_000_000,
      slippageBps: 100,
    });

    expect(preparation.pool).toBe(
      "0x59E8fACAe344e8ed08b3030c12C214adFbe439f5",
    );
    expect(preparation.sqrtPriceX96).toBe(
      880_312_912_863_751_171_568_005_199n,
    );
    expect(preparation.tickLower).toBe(-887_220);
    expect(preparation.tickUpper).toBe(887_220);
    expect(preparation.amount0Min).toBe((amountA * 9_900n) / 10_000n);
    expect(preparation.amount1Min).toBe((amountB * 9_900n) / 10_000n);
    expect(preparation.calldata.startsWith("0xac9650d8")).toBe(true);
    expect(preparation.value).toBe(0n);

    const outer = decodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      data: preparation.calldata,
    });
    expect(outer.functionName).toBe("multicall");
    if (outer.functionName !== "multicall")
      throw new Error("Expected a Position Manager multicall.");
    const calls = outer.args[0];
    expect(calls).toHaveLength(2);
    expect(
      decodeFunctionData({ abi: POSITION_MANAGER_ABI, data: calls[0] })
        .functionName,
    ).toBe("createAndInitializePoolIfNecessary");
    expect(
      decodeFunctionData({ abi: POSITION_MANAGER_ABI, data: calls[1] })
        .functionName,
    ).toBe("mint");
  });

  it("sorts tokens without changing their paired amounts", () => {
    const preparation = prepareFullRangeUniswapV3Position({
      factory: FACTORY,
      tokenA: TOKEN_B,
      amountA: 7n,
      tokenB: TOKEN_A,
      amountB: 11n,
      fee: 3_000,
      recipient: OWNER,
      deadline: 1_800_000_000,
      slippageBps: 100,
    });

    expect(preparation.token0).toBe(TOKEN_A);
    expect(preparation.token1).toBe(TOKEN_B);
    expect(preparation.amount0).toBe(11n);
    expect(preparation.amount1).toBe(7n);
  });

  it("rejects invalid amounts and keeps pool derivation deterministic", () => {
    expect(() => encodeSqrtPriceX96(1n, 0n)).toThrow(
      "Initial pool amounts must be greater than zero.",
    );
    expect(
      computeUniswapV3PoolAddress({
        factory: FACTORY,
        token0: TOKEN_A,
        token1: TOKEN_B,
        fee: 3_000,
      }),
    ).toBe("0x59E8fACAe344e8ed08b3030c12C214adFbe439f5");
  });
});
