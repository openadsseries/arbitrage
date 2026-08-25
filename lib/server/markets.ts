import "server-only";

import { BOND_ABI, mintclub } from "@mint.club/v2-sdk";
import { getAddress, isAddressEqual, parseAbi, zeroAddress, type Address } from "viem";
import { CHAINS, getChain, type ChainKey } from "@/lib/chains";
import { findKnownMarket, knownMarketsForChain } from "@/lib/known-markets";
import type { BondActivity, PortfolioSnapshot, VerifiedMarket } from "@/lib/onchain-types";
import { discoverDirectUniswapMarket } from "@/lib/server/uniswap-market";

const FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

const POOL_ABI = parseAbi([
  "function liquidity() view returns (uint128)",
]);

const FEE_TIERS = [100, 500, 3000, 10_000] as const;
const RECENT_BOND_WINDOW: Record<ChainKey, number> = { base: 400, robinhood: 1_000 };

function sdkNetwork(chain: ChainKey) {
  return mintclub.network(chain);
}

async function findPool(chain: ChainKey, token: Address): Promise<VerifiedMarket["pool"]> {
  const capability = CHAINS[chain];
  const client = sdkNetwork(chain).getPublicClient();
  const candidates = capability.quoteAssets.flatMap((quote) =>
    FEE_TIERS.map((fee) => ({ quote, fee })),
  );
  const results = await client.multicall({
    allowFailure: true,
    contracts: candidates.map(({ quote, fee }) => ({
      address: capability.uniswapV3Factory,
      abi: FACTORY_ABI,
      functionName: "getPool" as const,
      args: [token, quote.address, fee] as const,
    })),
  });
  const deployed = results.flatMap((result, index) => (
    result.status === "success" && result.result !== zeroAddress
      ? [{ address: getAddress(result.result), candidate: candidates[index] }]
      : []
  ));
  if (deployed.length === 0) return null;
  const liquidityResults = await client.multicall({
    allowFailure: true,
    contracts: deployed.map(({ address }) => ({
      address,
      abi: POOL_ABI,
      functionName: "liquidity" as const,
    })),
  });
  const active = deployed.flatMap((pool, index) => {
    const result = liquidityResults[index];
    return result.status === "success" && result.result > 0n
      ? [{ ...pool, liquidity: result.result }]
      : [];
  }).sort((left, right) => left.liquidity > right.liquidity ? -1 : left.liquidity < right.liquidity ? 1 : 0);
  const best = active[0];
  if (!best) return null;
  return {
    address: best.address,
    quoteToken: best.candidate.quote.address,
    quoteSymbol: best.candidate.quote.symbol,
    fee: best.candidate.fee,
    liquidityRaw: best.liquidity.toString(),
  };
}

async function readMarket(
  chain: ChainKey,
  tokenAddress: Address,
  blockNumber: bigint,
  readAt: string,
  includeDirectMarket = false,
): Promise<VerifiedMarket | null> {
  const definition = findKnownMarket(chain, tokenAddress);
  const network = sdkNetwork(chain);
  const token = network.token(tokenAddress);
  if (!(await token.exists())) return null;
  const [name, symbol, decimals, currentSupply, maxSupply, nextMintPrice, bond, usdRate] = await Promise.all([
    token.getName(),
    token.getSymbol(),
    token.getDecimals(),
    token.getTotalSupply(),
    token.getMaxSupply(),
    token.getPriceForNextMint(),
    token.getTokenBond(),
    token.getUsdRate({ amount: 1 }).then((result) => result.usdRate).catch(() => null),
  ]);
  const reserve = network.token(bond.reserveToken);
  const registeredMarket = definition?.uniswapMarket
    ? { ...definition.uniswapMarket, liquidityRaw: null }
    : null;
  const directMarketPromise = registeredMarket
    ? Promise.resolve({ status: "found", market: registeredMarket } as const)
    : includeDirectMarket
      ? discoverDirectUniswapMarket(chain, tokenAddress, decimals)
    : Promise.resolve({ status: "not-checked", market: null } as const);
  const [reserveName, reserveSymbol, reserveDecimals, pool, directMarketCheck] = await Promise.all([
    reserve.getName(),
    reserve.getSymbol(),
    reserve.getDecimals(),
    findPool(chain, tokenAddress),
    directMarketPromise,
  ]);
  const impliedMarketCapReserve = currentSupply * nextMintPrice / (10n ** BigInt(decimals));
  const supply = Number(currentSupply) / (10 ** decimals);
  const impliedMarketCapUsd = usdRate === null ? null : supply * usdRate;
  return {
    chain,
    blockNumber: blockNumber.toString(),
    readAt,
    token: getAddress(tokenAddress),
    name,
    symbol,
    decimals,
    creator: getAddress(bond.creator),
    createdAt: Number(bond.createdAt),
    currentSupplyRaw: currentSupply.toString(),
    maxSupplyRaw: maxSupply.toString(),
    reserveToken: getAddress(bond.reserveToken),
    reserveName,
    reserveSymbol,
    reserveDecimals,
    reserveBalanceRaw: bond.reserveBalance.toString(),
    nextMintPriceRaw: nextMintPrice.toString(),
    impliedMarketCapReserveRaw: impliedMarketCapReserve.toString(),
    priceUsd: usdRate,
    impliedMarketCapUsd: Number.isFinite(impliedMarketCapUsd) ? impliedMarketCapUsd : null,
    mintRoyaltyBps: Number(bond.mintRoyalty),
    burnRoyaltyBps: Number(bond.burnRoyalty),
    provenance: definition ? "reviewed" : "mint-club",
    reserveVerified: definition ? isAddressEqual(bond.reserveToken, definition.expectedReserve) : true,
    mintClubUrl: definition?.mintClubUrl ?? `https://mint.club/token/${chain}/${symbol}`,
    pool,
    directMarket: directMarketCheck.market,
    directMarketStatus: directMarketCheck.status,
  } satisfies VerifiedMarket;
}

export async function readVerifiedMarkets(chain: ChainKey): Promise<VerifiedMarket[]> {
  const definitions = knownMarketsForChain(chain);
  const network = sdkNetwork(chain);
  const client = sdkNetwork(chain).getPublicClient();
  const [blockNumber, tokenCount] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({
      address: CHAINS[chain].mintClubBond,
      abi: BOND_ABI,
      functionName: "tokenCount",
    }),
  ]);
  const readAt = new Date().toISOString();
  const end = Number(tokenCount);
  const start = Math.max(0, end - RECENT_BOND_WINDOW[chain]);
  const recent = await network.bond.getList({ start, end }).catch(() => []);
  const discovered = recent.filter((bond) => {
    const expectedSymbol = `h${bond.reserveSymbol}`.slice(0, 12).toLowerCase();
    const expectedName = `Hyped ${bond.reserveSymbol}`.toLowerCase();
    return bond.symbol.toLowerCase() === expectedSymbol || bond.name.toLowerCase() === expectedName;
  });
  const addresses = new Map<string, Address>();
  for (const definition of definitions) addresses.set(definition.token.toLowerCase(), definition.token);
  for (const bond of discovered) addresses.set(bond.token.toLowerCase(), getAddress(bond.token));
  const markets = await Promise.all(
    [...addresses.values()].map((address) => readMarket(chain, address, blockNumber, readAt)),
  );
  return markets.filter((market): market is VerifiedMarket => market !== null);
}

export async function readVerifiedMarket(chain: ChainKey, address: Address): Promise<VerifiedMarket | null> {
  const client = sdkNetwork(chain).getPublicClient();
  const [blockNumber] = await Promise.all([client.getBlockNumber()]);
  return readMarket(chain, address, blockNumber, new Date().toISOString(), true);
}

async function readBondActivity(chain: ChainKey, wallet: Address, markets: VerifiedMarket[]) {
  if (markets.length === 0) return [];
  const capability = getChain(chain);
  if (!capability) return [];
  const client = sdkNetwork(chain).getPublicClient();
  const activity = await Promise.all(markets.map(async (market) => {
    const fromBlock = await mintclub.utils.getBlockNumber({
      chainId: capability.id,
      timestamp: market.createdAt,
    });
    const [mintLogs, burnLogs] = await Promise.all([
      client.getContractEvents({
        address: capability.mintClubBond,
        abi: BOND_ABI,
        eventName: "Mint",
        args: { token: market.token, user: wallet },
        fromBlock,
        toBlock: "latest",
      }),
      client.getContractEvents({
        address: capability.mintClubBond,
        abi: BOND_ABI,
        eventName: "Burn",
        args: { token: market.token, user: wallet },
        fromBlock,
        toBlock: "latest",
      }),
    ]);
    const common = {
      chain,
      token: market.token,
      tokenSymbol: market.symbol,
      tokenDecimals: market.decimals,
      reserveToken: market.reserveToken,
      reserveSymbol: market.reserveSymbol,
      reserveDecimals: market.reserveDecimals,
    } as const;
    return [
      ...mintLogs.map((log) => ({
        ...common,
        type: "Mint" as const,
        tokenAmountRaw: log.args.amountMinted?.toString() ?? "0",
        reserveAmountRaw: log.args.reserveAmount?.toString() ?? "0",
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
      } satisfies BondActivity)),
      ...burnLogs.map((log) => ({
        ...common,
        type: "Burn" as const,
        tokenAmountRaw: log.args.amountBurned?.toString() ?? "0",
        reserveAmountRaw: log.args.refundAmount?.toString() ?? "0",
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
      } satisfies BondActivity)),
    ];
  }));
  return activity.flat().sort((a, b) => {
    const left = BigInt(a.blockNumber);
    const right = BigInt(b.blockNumber);
    return left === right ? 0 : left > right ? -1 : 1;
  });
}

export async function readPortfolio(chain: ChainKey, wallet: Address): Promise<PortfolioSnapshot> {
  const network = sdkNetwork(chain);
  const client = network.getPublicClient();
  const blockNumber = await client.getBlockNumber();
  const [reviewedMarkets, createdTokens] = await Promise.all([
    readVerifiedMarkets(chain),
    network.bond.getTokensByCreator({ creator: wallet, start: 0, end: 1000 }),
  ]);
  const createdMarkets = await Promise.all(
    createdTokens.map((token) => readMarket(chain, getAddress(token), blockNumber, new Date().toISOString())),
  );
  const marketMap = new Map<string, VerifiedMarket>();
  for (const market of [...reviewedMarkets, ...createdMarkets]) {
    if (market) marketMap.set(market.token.toLowerCase(), market);
  }
  const markets = [...marketMap.values()];
  const positionResults = await Promise.all(markets.map(async (market) => {
    const token = network.token(market.token);
    const balance = await token.getBalanceOf(wallet);
    if (balance === 0n) return null;
    const [redeemable, burnRoyalty] = await token.getSellEstimation(balance);
    return {
      market,
      balanceRaw: balance.toString(),
      redeemableRaw: redeemable.toString(),
      burnRoyaltyRaw: burnRoyalty.toString(),
      costBasis: "unavailable" as const,
    };
  }));
  let activity: BondActivity[] = [];
  try {
    activity = await readBondActivity(chain, wallet, markets);
  } catch {
    // A rate-limited history provider must not make current balances unavailable.
  }
  return {
    chain,
    wallet,
    blockNumber: blockNumber.toString(),
    readAt: new Date().toISOString(),
    positions: positionResults.filter((position): position is NonNullable<typeof position> => position !== null),
    launches: markets.filter((market) => isAddressEqual(market.creator, wallet)),
    activity,
  };
}

export async function readContractHealth(chain: ChainKey) {
  const capability = CHAINS[chain];
  const client = sdkNetwork(chain).getPublicClient();
  const contracts = [
    ["Mint Club exchange", capability.mintClubBond],
    ["Mint Club token implementation", capability.mintClubTokenImplementation],
    ["Mint Club routing Zap", capability.mintClubZap],
    ["Uniswap V3 Factory", capability.uniswapV3Factory],
    ["Uniswap Position Manager", capability.nonfungiblePositionManager],
    ["Uniswap Quoter", capability.quoter],
  ] as const;
  const [blockNumber, results] = await Promise.all([
    client.getBlockNumber(),
    Promise.all(contracts.map(async ([name, address]) => {
      const code = await client.getBytecode({ address });
      return { name, address, deployed: Boolean(code && code !== "0x") };
    })),
  ]);
  return {
    chain,
    chainId: capability.id,
    blockNumber: blockNumber.toString(),
    readAt: new Date().toISOString(),
    contracts: results,
  };
}
