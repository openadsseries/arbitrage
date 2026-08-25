import type { Address, Hex } from "viem";
import type { ChainKey } from "@/lib/chains";

export type RiskStatus = "supported" | "warning" | "blocked" | "unknown";
export type LaunchStage =
  | "analyzed"
  | "configured"
  | "token-created"
  | "reserve-acquired"
  | "hyped-minted"
  | "pool-created"
  | "verified";

export type TokenAnalysis = {
  chain: ChainKey;
  chainId: number;
  tokenAddress: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupplyRaw: string;
  totalSupplyFormatted: string;
  blockNumber: string;
  analyzedAt: string;
  riskStatus: RiskStatus;
  riskReasons: string[];
  marketPrice?: {
    usd: number;
    liquidityUsd: number;
    sourcePool: Hex;
    sourceUrl: string;
    checkedAt: string;
  } | null;
  capabilities: {
    metadataReadable: boolean;
    transferPreflightRequired: boolean;
  };
};

export type LiquidityPreparation = {
  chain: ChainKey;
  readBlock: string;
  expiresAt: string;
  owner: Address;
  hypedToken: Address;
  hypedSymbol: string;
  hypedDecimals: number;
  reserveToken: Address;
  reserveSymbol: string;
  reserveDecimals: number;
  hypedAmountRaw: string;
  reserveRequiredRaw: string;
  maxReserveAmountRaw: string;
  quoteToken: Address;
  quoteSymbol: string;
  quoteDecimals: number;
  quoteAmountRaw: string;
  sourcePool: Address | null;
  sourcePoolFee: number;
  pool: Address;
  poolFee: number;
  positionManager: Address;
  positionAmountHypedRaw: string;
  positionAmountQuoteRaw: string;
  calldata: `0x${string}`;
  valueRaw: string;
};

export type ArbitragePreview = {
  chain: ChainKey;
  readBlock: string;
  hypedToken: Address;
  hypedSymbol: string;
  hypedDecimals: number;
  hypedAmountRaw: string;
  reserveToken: Address;
  reserveSymbol: string;
  reserveDecimals: number;
  quoteToken: Address;
  quoteSymbol: string;
  quoteDecimals: number;
  mintRoute: {
    quoteInRaw: string;
    quoteOutRaw: string;
    differenceRaw: string;
    profitableBeforeGas: boolean;
  };
  redeemRoute: {
    quoteInRaw: string;
    quoteOutRaw: string;
    differenceRaw: string;
    profitableBeforeGas: boolean;
  };
};

export type LaunchManifest = {
  schemaVersion: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  stage: LaunchStage;
  chain: ChainKey;
  owner: Address | null;
  input: {
    backingToken: Address;
    hypedName: string;
    hypedSymbol: string;
  };
  analysis: TokenAnalysis;
  configuration: {
    maxSupply: number;
    stepCount: number;
    initialMintingPrice: number;
    finalMintingPrice: number;
    creatorAllocation: number;
    buyRoyalty: number;
    sellRoyalty: number;
  } | null;
  liquidity: {
    hypedAmountRaw: string;
    reserveSpentRaw: string;
    quoteToken: Address;
    quoteSymbol: string;
    quoteDecimals: number;
    quoteAmountRaw: string;
    fee: number;
  } | null;
  execution: {
    txs: Partial<Record<LaunchStage, `0x${string}`>>;
    hypedToken: Address | null;
    pool: Address | null;
    lpTokenId: string | null;
  };
  provenance: {
    analysisBlock: string;
    quoteExpiresAt: string | null;
    policyVersion: string;
  };
};
