import type { Address } from "viem";
import type { ChainKey } from "@/lib/chains";

export type KnownMarket = {
  chain: ChainKey;
  token: Address;
  expectedReserve: Address;
  mintClubUrl: string;
  uniswapMarket?: {
    protocol: "V2" | "V3" | "V4";
    reference: `0x${string}`;
    quoteToken: Address;
    quoteSymbol: string;
    fee: number | null;
  };
};

const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as const;

// Migration seeds keep the first four verified markets visible. New GETHYPED
// launches are discovered from recent Mint Club state instead of being added here.
export const KNOWN_MARKETS: readonly KnownMarket[] = [
  {
    chain: "base",
    token: "0x467bA2Da859648dc7C258BcF6572adE499250E6a",
    expectedReserve: "0xFf45161474C39cB00699070Dd49582e417b57a7E",
    mintClubUrl: "https://mint.club/token/base/hMT",
    uniswapMarket: {
      protocol: "V4",
      reference: "0x9c2183f7d3f6b691d3d462679009c729696b8303e4396051fbb788b016a6a042",
      quoteToken: NATIVE_ETH,
      quoteSymbol: "ETH",
      fee: 10_000,
    },
  },
  {
    chain: "base",
    token: "0x23879479070377fAFE1dC101FBB5d263696b9d61",
    expectedReserve: "0x3ec2156D4c0A9CBdAB4a016633b7BcF6a8d68Ea2",
    mintClubUrl: "https://mint.club/token/base/hDRB",
    uniswapMarket: {
      protocol: "V4",
      reference: "0x4233d40eed360e9c52f67189a7dcc48384c441238baadeae27e12ceb0af9ed78",
      quoteToken: NATIVE_ETH,
      quoteSymbol: "ETH",
      fee: 10_000,
    },
  },
  {
    chain: "base",
    token: "0x94FF3398d08bb859E0D2CdC7A3F938AA7B109069",
    expectedReserve: "0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b",
    mintClubUrl: "https://mint.club/token/base/hBNKR",
    uniswapMarket: {
      protocol: "V4",
      reference: "0xaa363db06062f8fff4db0895858fdc04220e11ab0089769728d0f31b10e0b22d",
      quoteToken: NATIVE_ETH,
      quoteSymbol: "ETH",
      fee: 10_000,
    },
  },
  {
    chain: "base",
    token: "0xe0d1bC936c8724DBdCb87dB11441fb3bb6b364ce",
    expectedReserve: "0x2D57C47BC5D2432FEEEdf2c9150162A9862D3cCf",
    mintClubUrl: "https://mint.club/token/base/hDICKBUTT",
    uniswapMarket: {
      protocol: "V4",
      reference: "0xb6219fa341732a9ecc980a66e0f8c591eefcf17c4ab2fac38fd718dd6e8de041",
      quoteToken: NATIVE_ETH,
      quoteSymbol: "ETH",
      fee: 10_000,
    },
  },
] as const;

export function knownMarketsForChain(chain: ChainKey) {
  return KNOWN_MARKETS.filter((market) => market.chain === chain);
}

export function findKnownMarket(chain: ChainKey, token: string) {
  return KNOWN_MARKETS.find(
    (market) => market.chain === chain && market.token.toLowerCase() === token.toLowerCase(),
  );
}
