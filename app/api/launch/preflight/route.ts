import { NextResponse } from "next/server";
import { mintclub } from "@mint.club/v2-sdk";
import { erc20Abi, formatUnits, getAddress } from "viem";
import { z } from "zod";
import {
  MIN_PRICE_SOURCE_LIQUIDITY_USD,
  calculateBackingFromSteps,
  calibrateLaunchCurve,
} from "@/lib/launch-curve";
import { readTokenMarketPrice } from "@/lib/server/gecko-market";
import {
  rateLimit,
  readBoundedJson,
  RequestGuardError,
} from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

const schema = z.object({
  chain: z.enum(["base", "robinhood"]),
  symbol: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^h[A-Za-z0-9]+$/i, "The Hyped Token symbol must begin with h."),
  name: z.string().trim().min(2).max(32),
  reserveToken: z.string(),
  reserveDecimals: z.number().int().min(0).max(18),
  maxSupply: z.number().positive().max(1_000_000_000_000),
  stepCount: z.number().int().min(2).max(1000),
  creatorAllocation: z.number().min(0),
  buyRoyalty: z.number().min(0).max(10),
  sellRoyalty: z.number().min(0).max(10),
});

export async function POST(request: Request) {
  const limited = rateLimit(request, "launch-preflight", {
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    const input = schema.parse(await readBoundedJson(request, 8_192));
    if (input.creatorAllocation > input.maxSupply) {
      return NextResponse.json(
        { error: "Creator allocation cannot exceed maximum supply." },
        { status: 400 },
      );
    }
    const reserveToken = getAddress(input.reserveToken);
    const network = mintclub.network(input.chain);
    const publicClient = network.getPublicClient();
    const token = network.token(input.symbol);
    const [marketPrice, totalSupplyRaw, reserveDecimals, blockNumber] =
      await Promise.all([
        readTokenMarketPrice(input.chain, reserveToken, { fresh: true }),
        publicClient.readContract({
          address: reserveToken,
          abi: erc20Abi,
          functionName: "totalSupply",
        }),
        publicClient.readContract({
          address: reserveToken,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        publicClient.getBlockNumber(),
      ]);
    if (reserveDecimals !== input.reserveDecimals) {
      throw new Error(
        "Reserve Token decimals changed. Analyze the token again.",
      );
    }
    if (!marketPrice)
      throw new Error(
        "A live USD price is required to calculate the $1M reserve.",
      );
    if (marketPrice.liquidityUsd < MIN_PRICE_SOURCE_LIQUIDITY_USD) {
      throw new Error(
        "The most liquid USD price source is too small to set a $1M reserve safely.",
      );
    }

    const calibrated = calibrateLaunchCurve({
      reserveToken: { address: reserveToken, decimals: reserveDecimals },
      reservePriceUsd: marketPrice.usd,
      reserveTotalSupply: Number(formatUnits(totalSupplyRaw, reserveDecimals)),
      settings: {
        maxSupply: input.maxSupply,
        stepCount: input.stepCount,
        creatorAllocation: input.creatorAllocation,
        buyRoyalty: input.buyRoyalty,
        sellRoyalty: input.sellRoyalty,
      },
    });
    const createParams = {
      name: input.name,
      reserveToken: { address: reserveToken, decimals: reserveDecimals },
      curveData: {
        curveType: "EXPONENTIAL" as const,
        stepCount: calibrated.configuration.stepCount,
        maxSupply: calibrated.configuration.maxSupply,
        initialMintingPrice: calibrated.configuration.initialMintingPrice,
        finalMintingPrice: calibrated.configuration.finalMintingPrice,
        creatorAllocation: calibrated.configuration.creatorAllocation,
      },
      buyRoyalty: calibrated.configuration.buyRoyalty,
      sellRoyalty: calibrated.configuration.sellRoyalty,
    };
    const { fee, args } = await token.checkAndPrepareCreateArgs(createParams);
    const preparedBacking = calculateBackingFromSteps(
      args.bondParams.stepRanges,
      args.bondParams.stepPrices,
      reserveDecimals,
    );
    if (preparedBacking.backingRaw !== calibrated.backing.backingRaw) {
      throw new Error(
        "The reviewed Mint Club curve does not match the calibrated reserve.",
      );
    }
    return NextResponse.json({
      preflight: {
        creationFeeRaw: fee.toString(),
        stepCount: args.bondParams.stepRanges.length,
        firstRangeRaw: args.bondParams.stepRanges[0]?.toString() ?? "0",
        lastRangeRaw: args.bondParams.stepRanges.at(-1)?.toString() ?? "0",
        firstPriceRaw: args.bondParams.stepPrices[0]?.toString() ?? "0",
        lastPriceRaw: args.bondParams.stepPrices.at(-1)?.toString() ?? "0",
        stepRangesRaw: args.bondParams.stepRanges.map((value) =>
          value.toString(),
        ),
        stepPricesRaw: args.bondParams.stepPrices.map((value) =>
          value.toString(),
        ),
        blockNumber: blockNumber.toString(),
        configuration: calibrated.configuration,
        backingAtFullSupply: calibrated.backing.backingFormatted,
        actualReserveUsd: calibrated.actualReserveUsd,
        targetReserveUsd: calibrated.targetReserveUsd,
        marketPrice,
      },
    });
  } catch (error) {
    if (error instanceof RequestGuardError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Mint Club preflight failed.";
    const cleanMessage = message.includes("Token already exists")
      ? "That Hyped Token symbol already exists on the selected Mint Club network."
      : message;
    return NextResponse.json({ error: cleanMessage }, { status: 400 });
  }
}
