# GETHYPED execution contracts

`HypedArbitrageExecutorV3` is the current non-custodial continuous executor. Users authorize a per-trade amount and a cumulative amount of the market's Reserve Token. Profitable routes can repeat until the user stops, the optional end time is reached, or the cumulative amount is consumed. Every successful transaction begins and ends in that same Reserve Token.

- Reserve → mint Hyped Token → sell Hyped Token → buy Reserve
- Reserve → sell Reserve → buy Hyped Token → redeem Reserve

WETH can be used inside the Uniswap route, but it is not the user's accounting asset. The transaction reverts unless the owner receives the authorized Reserve principal plus the protected net profit.

The policy is fixed in bytecode:

- GETHYPED fee: `0%`
- Successful executor reward: `20%` of realized Reserve profit
- User share: `80%` of realized Reserve profit

The contract has no owner, guardian, upgrade function, arbitrary external call, or withdrawal function. It supports one active permission per wallet and Reserve Token so the exact allowance can be revoked safely. It stores no user funds between executions.

## Verify locally

```sh
forge fmt --check
forge test -vv
```

## Immutable Base inputs

1. WETH: `0x4200000000000000000000000000000000000006`
2. Mint Club Bond: `0xc5a076cad94176c2996B32d8466Be1cE757FAa27`
3. Uniswap Onchain Router: `0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02`

## Current Base deployment

- Continuous Reserve executor V3: `0xbB7AF71818fD1a269f21D0b5E4d8F7CF5401Ac3C`
- Deployment block: `50422622`
- Deployment transaction: `0x9314bccfdc606c7e98374526d802c2fad4494abfae3eff74ac53bb8c47881682`
- Source verification: Sourcify exact match

Set `NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V3` and `ARBITRAGE_EXECUTOR_V3_DEPLOYMENT_BLOCK` in the application environment. `npm run keeper` uses V3 and must run as a persistent process outside Vercel.

## Previous one-time Base deployment

- Reserve executor V2: `0xBD3aC7f06F39A3D1E3ac905A57c1CbD067be71f1`
- Deployment block: `50412040`
- Deployment transaction: `0x1984b8d1f2266e3ee3f51343515057fbb496f015126631577562a782f19d16fe`
- Source verification: Sourcify exact match

Keep `NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V2` and `ARBITRAGE_EXECUTOR_V2_DEPLOYMENT_BLOCK` only so earlier one-time permissions can be reviewed and stopped. Its keeper is available as `npm run keeper:one-shot` for recovery operations.

## Legacy executor

`HypedArbitrageExecutor` settles in WETH and is retained only so existing users can stop or revoke older permissions. Do not create new strategies with it. Its keeper is available only as `npm run keeper:legacy` for recovery operations.
