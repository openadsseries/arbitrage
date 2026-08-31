import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@mint.club/v2-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mint.club/v2-sdk")>();
  return {
    ...original,
    binaryReverseMint: vi.fn(
      ({ reserveAmount }: { reserveAmount: bigint }) => reserveAmount,
    ),
  };
});

const EXECUTOR = "0x6Aad2b4BB89813B4E0Db43170c8b314417B1D571";
const OWNER = "0x673F0277f9B7Aaebc80A07c199dbF32007455495";
const HMT = "0x467bA2Da859648dc7C258BcF6572adE499250E6a";
const MT = "0xFf45161474C39cB00699070Dd49582e417b57a7E";

describe("V4 relay assessment failures", () => {
  const previousExecutor = process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4 = EXECUTOR;
  });

  afterAll(() => {
    if (previousExecutor === undefined) {
      delete process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4;
    } else {
      process.env.NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4 = previousExecutor;
    }
  });

  it("returns quote-unavailable when the strategy read fails through RPC", async () => {
    const { readDirectArbitrageExecutionStatusV4 } =
      await import("./arbitrage-execution");
    const client = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          if (functionName === "strategies") {
            throw new Error("Contract call failed", {
              cause: new Error("HTTP request failed with status 429"),
            });
          }
          return 1_000n;
        },
      ),
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
    };

    const result = await readDirectArbitrageExecutionStatusV4({
      owner: OWNER,
      strategyId: 1n,
      client: client as never,
    });

    expect(result).toEqual({
      status: "unavailable",
      code: "quote-unavailable",
      error: "Price check unavailable.",
    });
  });

  it("keeps a completed inactive strategy distinct from quote failure", async () => {
    const { readDirectArbitrageExecutionStatusV4 } =
      await import("./arbitrage-execution");
    const client = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          if (functionName === "strategies") {
            return [
              OWNER,
              HMT,
              MT,
              0n,
              false,
              0n,
              0n,
              1_000n,
              0n,
              1n,
              10n,
              10n,
            ] as const;
          }
          return 1_000n;
        },
      ),
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
    };

    const result = await readDirectArbitrageExecutionStatusV4({
      owner: OWNER,
      strategyId: 1n,
      client: client as never,
    });

    expect(result).toMatchObject({ status: "none", code: "inactive" });
  });

  it("quotes the same direct Reserve Token routes that V4 executes", async () => {
    const { readDirectArbitrageExecutionStatusV4 } =
      await import("./arbitrage-execution");
    const routePairs: Array<[string, string]> = [];
    const client = {
      readContract: vi.fn(
        async ({
          functionName,
          args,
        }: {
          functionName: string;
          args?: readonly unknown[];
        }) => {
          if (functionName === "strategies") {
            return [
              OWNER,
              HMT,
              MT,
              0n,
              true,
              0n,
              0n,
              1_000n,
              1_000n,
              1n,
              100n,
              1n,
            ] as const;
          }
          if (functionName === "executorProfitShareBps") return 1_000n;
          if (functionName === "balanceOf" || functionName === "allowance") {
            return 1_000n;
          }
          if (functionName === "getSteps") return [];
          if (functionName === "totalSupply") return 1n;
          if (functionName === "maxSupply") return 10_000n;
          if (functionName === "decimals") return 18;
          if (functionName === "tokenBond") {
            return [OWNER, 0, 0, 0, MT, 1_000n] as const;
          }
          if (functionName === "getReserveForToken") {
            return [args?.[1] as bigint, 0n] as const;
          }
          if (functionName === "routeExactInput") {
            const input = args?.[0] as {
              tokenIn: string;
              tokenOut: string;
              amountSpecified: bigint;
            };
            routePairs.push([input.tokenIn, input.tokenOut]);
            return { amountOut: input.amountSpecified + 100n };
          }
          if (functionName === "getRefundForTokens") {
            return [(args?.[1] as bigint) + 100n, 0n] as const;
          }
          return 1_000n;
        },
      ),
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
      simulateContract: vi.fn(async () => {
        throw new Error("RPC request failed: 429");
      }),
    };

    const result = await readDirectArbitrageExecutionStatusV4({
      owner: OWNER,
      strategyId: 1n,
      client: client as never,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      code: "quote-unavailable",
    });
    expect(routePairs.length).toBeGreaterThan(0);
    expect(
      routePairs.every(
        ([tokenIn, tokenOut]) =>
          (tokenIn === HMT && tokenOut === MT) ||
          (tokenIn === MT && tokenOut === HMT),
      ),
    ).toBe(true);
  });
});
