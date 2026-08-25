import { defineChain, type Address, type Chain } from "viem";
import { base } from "viem/chains";

export type ChainKey = "base" | "robinhood";

export type ChainCapability = {
  key: ChainKey;
  id: number;
  name: string;
  shortName: string;
  status: "stable" | "beta";
  rpcUrl: string;
  explorerUrl: string;
  quoteAssets: readonly {
    symbol: string;
    address: Address;
    decimals: number;
    stable: boolean;
  }[];
  weth: Address;
  mintClubBond: Address;
  mintClubTokenImplementation: Address;
  mintClubZap: Address;
  uniswapV3Factory: Address;
  swapRouter: Address;
  nonfungiblePositionManager: Address;
  quoter: Address;
};

export const CHAINS: Record<ChainKey, ChainCapability> = {
  base: {
    key: "base",
    id: 8453,
    name: "Base",
    shortName: "Base",
    status: "stable",
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    weth: "0x4200000000000000000000000000000000000006",
    quoteAssets: [
      {
        symbol: "WETH",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
        stable: false,
      },
      {
        symbol: "USDC",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        stable: true,
      },
    ],
    mintClubBond: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    mintClubTokenImplementation: "0xAa70bC79fD1cB4a6FBA717018351F0C3c64B79Df",
    mintClubZap: "0x96282046C0e19F727a92728198c0Dc4E260Ebe0b",
    uniswapV3Factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    swapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
    nonfungiblePositionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  },
  robinhood: {
    key: "robinhood",
    id: 4663,
    name: "Robinhood Chain",
    shortName: "Robinhood",
    status: "beta",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorerUrl: "https://robinhoodchain.blockscout.com",
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    quoteAssets: [
      {
        symbol: "WETH",
        address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
        decimals: 18,
        stable: false,
      },
      {
        symbol: "USDG",
        address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        decimals: 6,
        stable: true,
      },
    ],
    mintClubBond: "0x91523b39813F3F4E406ECe406D0bEAaA9dE251fa",
    mintClubTokenImplementation: "0xEb54dACB4C2ccb64F8074eceEa33b5eBb38E5387",
    mintClubZap: "0x621c335b4BD8f2165E120DC70d3AfcAfc6628681",
    uniswapV3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
    swapRouter: "0xcaf681a66d020601342297493863e78c959e5cb2",
    nonfungiblePositionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
    quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  },
};

export const CHAIN_LIST = Object.values(CHAINS);

export function getChain(key: string): ChainCapability | undefined {
  return CHAINS[key as ChainKey];
}

export function findCanonicalAsset(chain: ChainCapability, address: string) {
  return chain.quoteAssets.find(
    (asset) => asset.address.toLowerCase() === address.toLowerCase(),
  );
}

const robinhoodChain = defineChain({
  id: CHAINS.robinhood.id,
  name: CHAINS.robinhood.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [CHAINS.robinhood.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: CHAINS.robinhood.explorerUrl },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

export function getViemChain(key: ChainKey): Chain {
  return key === "base" ? base : robinhoodChain;
}

export function getChainKeyById(chainId: number): ChainKey | null {
  return CHAIN_LIST.find((chain) => chain.id === chainId)?.key ?? null;
}
