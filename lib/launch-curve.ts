import { generateCreateArgs } from "@mint.club/v2-sdk";
import { formatUnits, type Address } from "viem";

export const TARGET_RESERVE_USD = 1_000_000;
export const CURVE_PRICE_RATIO = 1_000;
export const MIN_PRICE_SOURCE_LIQUIDITY_USD = TARGET_RESERVE_USD * 0.01;

export type LaunchCurveConfiguration = {
  maxSupply: number;
  stepCount: number;
  initialMintingPrice: number;
  finalMintingPrice: number;
  creatorAllocation: number;
  buyRoyalty: number;
  sellRoyalty: number;
};

export type LaunchCurveSettings = Omit<
  LaunchCurveConfiguration,
  "initialMintingPrice" | "finalMintingPrice"
>;

export type CurveBacking = {
  backingRaw: bigint;
  backingFormatted: string;
  backingAmount: number;
  stepCount: number;
};

export function calculateBackingFromSteps(
  stepRanges: readonly bigint[],
  stepPrices: readonly bigint[],
  reserveDecimals: number,
): CurveBacking {
  if (stepRanges.length === 0 || stepRanges.length !== stepPrices.length) {
    throw new Error("The Mint Club price steps are invalid.");
  }

  let previousRange = 0n;
  let backingRaw = 0n;
  for (let index = 0; index < stepRanges.length; index += 1) {
    const range = stepRanges[index];
    const price = stepPrices[index];
    const invalidCreatorStep = price === 0n && index !== 0;
    if (range <= previousRange || invalidCreatorStep) {
      throw new Error("The Mint Club price steps are not strictly increasing.");
    }
    backingRaw += ((range - previousRange) * price) / 10n ** 18n;
    previousRange = range;
  }

  const backingFormatted = formatUnits(backingRaw, reserveDecimals);
  const backingAmount = Number(backingFormatted);
  if (!Number.isFinite(backingAmount) || backingAmount <= 0) {
    throw new Error("The selected token precision cannot represent this reserve target.");
  }

  return {
    backingRaw,
    backingFormatted,
    backingAmount,
    stepCount: stepRanges.length,
  };
}

export type CalibratedLaunchCurve = {
  configuration: LaunchCurveConfiguration;
  backing: CurveBacking;
  targetReserveAmount: number;
  targetReserveUsd: number;
  actualReserveUsd: number;
  errorRatio: number;
};

type ReserveToken = {
  address: Address;
  decimals: number;
};

const CALIBRATION_ITERATIONS = 40;
const MAX_TARGET_ERROR_RATIO = 0.001;

export const DEFAULT_LAUNCH_CURVE_SETTINGS: LaunchCurveSettings = {
  maxSupply: 1_000_000_000,
  stepCount: 100,
  creatorAllocation: 0,
  buyRoyalty: 1,
  sellRoyalty: 1,
};

export function calculateCurveBacking(
  configuration: LaunchCurveConfiguration,
  reserveToken: ReserveToken,
): CurveBacking {
  const { bondParams } = generateCreateArgs({
    tokenType: "ERC20",
    name: "Preview",
    symbol: "hPREVIEW",
    reserveToken,
    curveData: {
      curveType: "EXPONENTIAL",
      stepCount: configuration.stepCount,
      maxSupply: configuration.maxSupply,
      initialMintingPrice: configuration.initialMintingPrice,
      finalMintingPrice: configuration.finalMintingPrice,
      creatorAllocation: configuration.creatorAllocation,
    },
    buyRoyalty: configuration.buyRoyalty,
    sellRoyalty: configuration.sellRoyalty,
  });

  return calculateBackingFromSteps(
    bondParams.stepRanges,
    bondParams.stepPrices,
    reserveToken.decimals,
  );
}

function configurationAtPrice(
  settings: LaunchCurveSettings,
  initialMintingPrice: number,
): LaunchCurveConfiguration {
  return {
    ...settings,
    initialMintingPrice,
    finalMintingPrice: initialMintingPrice * CURVE_PRICE_RATIO,
  };
}

/**
 * Keeps one fixed exponential curve shape and scales its prices until the
 * exact discrete Mint Club reserve equals the USD target at the observed OG
 * price. Every comparison uses the SDK-generated onchain step arrays, so
 * reserve-decimal rounding and merged steps are part of the result.
 */
export function calibrateLaunchCurve({
  reserveToken,
  reservePriceUsd,
  reserveTotalSupply,
  settings = DEFAULT_LAUNCH_CURVE_SETTINGS,
  targetReserveUsd = TARGET_RESERVE_USD,
}: {
  reserveToken: ReserveToken;
  reservePriceUsd: number;
  reserveTotalSupply: number;
  settings?: LaunchCurveSettings;
  targetReserveUsd?: number;
}): CalibratedLaunchCurve {
  if (!Number.isFinite(reservePriceUsd) || reservePriceUsd <= 0) {
    throw new Error("A live USD price is required to calculate the reserve.");
  }
  if (!Number.isFinite(reserveTotalSupply) || reserveTotalSupply <= 0) {
    throw new Error("The OG token supply could not be verified.");
  }
  if (!Number.isFinite(targetReserveUsd) || targetReserveUsd <= 0) {
    throw new Error("The reserve target is invalid.");
  }
  if (
    !Number.isFinite(settings.maxSupply)
    || settings.maxSupply <= 0
    || !Number.isInteger(settings.stepCount)
    || settings.stepCount < 2
    || settings.creatorAllocation < 0
    || settings.creatorAllocation > settings.maxSupply
  ) {
    throw new Error("The curve settings are invalid.");
  }

  const targetReserveAmount = targetReserveUsd / reservePriceUsd;
  if (targetReserveAmount > reserveTotalSupply) {
    throw new Error("The OG token's full supply is worth less than the $1M reserve target.");
  }

  const unitConfiguration = configurationAtPrice(settings, 1);
  const unitBacking = calculateCurveBacking(unitConfiguration, reserveToken).backingAmount;
  const estimatedInitialPrice = targetReserveAmount / unitBacking;
  if (!Number.isFinite(estimatedInitialPrice) || estimatedInitialPrice <= 0) {
    throw new Error("The $1M curve could not be calculated for this token.");
  }

  let lowerPrice = estimatedInitialPrice * 0.5;
  let upperPrice = estimatedInitialPrice * 1.5;
  let lowerBacking = calculateCurveBacking(configurationAtPrice(settings, lowerPrice), reserveToken);
  let upperBacking = calculateCurveBacking(configurationAtPrice(settings, upperPrice), reserveToken);

  for (let attempt = 0; attempt < 24 && lowerBacking.backingAmount > targetReserveAmount; attempt += 1) {
    upperPrice = lowerPrice;
    upperBacking = lowerBacking;
    lowerPrice /= 2;
    lowerBacking = calculateCurveBacking(configurationAtPrice(settings, lowerPrice), reserveToken);
  }
  for (let attempt = 0; attempt < 24 && upperBacking.backingAmount < targetReserveAmount; attempt += 1) {
    lowerPrice = upperPrice;
    lowerBacking = upperBacking;
    upperPrice *= 2;
    upperBacking = calculateCurveBacking(configurationAtPrice(settings, upperPrice), reserveToken);
  }
  if (lowerBacking.backingAmount > targetReserveAmount || upperBacking.backingAmount < targetReserveAmount) {
    throw new Error("The $1M curve is outside the supported token precision range.");
  }

  let bestPrice = lowerPrice;
  let bestBacking = lowerBacking;
  let bestDifference = Math.abs(lowerBacking.backingAmount - targetReserveAmount);

  for (let iteration = 0; iteration < CALIBRATION_ITERATIONS; iteration += 1) {
    const candidatePrice = (lowerPrice + upperPrice) / 2;
    const candidateBacking = calculateCurveBacking(configurationAtPrice(settings, candidatePrice), reserveToken);
    const difference = Math.abs(candidateBacking.backingAmount - targetReserveAmount);
    if (difference < bestDifference) {
      bestPrice = candidatePrice;
      bestBacking = candidateBacking;
      bestDifference = difference;
    }
    if (candidateBacking.backingAmount < targetReserveAmount) {
      lowerPrice = candidatePrice;
    } else {
      upperPrice = candidatePrice;
    }
  }

  const configuration = configurationAtPrice(settings, bestPrice);
  const actualReserveUsd = bestBacking.backingAmount * reservePriceUsd;
  const errorRatio = Math.abs(actualReserveUsd - targetReserveUsd) / targetReserveUsd;
  if (!Number.isFinite(actualReserveUsd) || errorRatio > MAX_TARGET_ERROR_RATIO) {
    throw new Error("The token precision cannot produce a $1M reserve accurately enough.");
  }

  return {
    configuration,
    backing: bestBacking,
    targetReserveAmount,
    targetReserveUsd,
    actualReserveUsd,
    errorRatio,
  };
}
