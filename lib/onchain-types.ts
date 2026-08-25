import type { Address } from "viem";
import type { ChainKey } from "@/lib/chains";

export type VerifiedMarket = {
  chain: ChainKey;
  blockNumber: string;
  readAt: string;
  token: Address;
  name: string;
  symbol: string;
  decimals: number;
  creator: Address;
  createdAt: number;
  currentSupplyRaw: string;
  maxSupplyRaw: string;
  reserveToken: Address;
  reserveName: string;
  reserveSymbol: string;
  reserveDecimals: number;
  reserveBalanceRaw: string;
  nextMintPriceRaw: string;
  impliedMarketCapReserveRaw: string;
  priceUsd: number | null;
  impliedMarketCapUsd: number | null;
  mintRoyaltyBps: number;
  burnRoyaltyBps: number;
  provenance: "reviewed" | "mint-club";
  reserveVerified: boolean;
  mintClubUrl: string;
  pool: {
    address: Address;
    quoteToken: Address;
    quoteSymbol: string;
    fee: number;
    liquidityRaw: string;
  } | null;
  directMarket: {
    protocol: "V2" | "V3" | "V4";
    reference: `0x${string}`;
    quoteToken: Address;
    quoteSymbol: string;
    fee: number | null;
    liquidityRaw: string | null;
  } | null;
  directMarketStatus: "found" | "not-found" | "unavailable" | "not-checked";
};

export type PortfolioPosition = {
  market: VerifiedMarket;
  balanceRaw: string;
  redeemableRaw: string;
  burnRoyaltyRaw: string;
  costBasis: "unavailable";
};

export type BondActivity = {
  chain: ChainKey;
  type: "Mint" | "Burn";
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  reserveToken: Address;
  reserveSymbol: string;
  reserveDecimals: number;
  tokenAmountRaw: string;
  reserveAmountRaw: string;
  transactionHash: `0x${string}`;
  blockNumber: string;
};

export type PortfolioSnapshot = {
  chain: ChainKey;
  wallet: Address;
  blockNumber: string;
  readAt: string;
  positions: PortfolioPosition[];
  launches: VerifiedMarket[];
  activity: BondActivity[];
};

export type MarketAssetKind = "og" | "hyped";
