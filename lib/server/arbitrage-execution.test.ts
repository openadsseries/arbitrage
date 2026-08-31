import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
    const { readDirectArbitrageExecutionStatusV4 } = await import(
      "./arbitrage-execution"
    );
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "strategies") {
          throw new Error("Contract call failed", {
            cause: new Error("HTTP request failed with status 429"),
          });
        }
        return 1_000n;
      }),
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
    const { readDirectArbitrageExecutionStatusV4 } = await import(
      "./arbitrage-execution"
    );
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
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
      }),
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
    };

    const result = await readDirectArbitrageExecutionStatusV4({
      owner: OWNER,
      strategyId: 1n,
      client: client as never,
    });

    expect(result).toMatchObject({ status: "none", code: "inactive" });
  });
});
