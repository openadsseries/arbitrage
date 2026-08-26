# Base deployment record

## Current continuous Reserve Token executor

`HypedArbitrageExecutorV3` was deployed at `0xbB7AF71818fD1a269f21D0b5E4d8F7CF5401Ac3C` in Base block `50422622`.

- Transaction: `0x9314bccfdc606c7e98374526d802c2fad4494abfae3eff74ac53bb8c47881682`
- Source verification: Sourcify exact match
- WETH: `0x4200000000000000000000000000000000000006`
- Mint Club Bond: `0xc5a076cad94176c2996B32d8466Be1cE757FAa27`
- Uniswap Onchain Router: `0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02`
- GETHYPED fee: `0%`
- Successful executor reward: `20%` of realized Reserve Token profit
- Duration: optional; zero means active until the user stops
- Permission: bounded per execution and by cumulative Reserve Token volume

The owner can stop at any time. Each successful execution atomically returns the Reserve Token principal and protected profit. The contract stores no user funds between executions.

## Previous one-time Reserve Token executor

`HypedArbitrageExecutorV2` was deployed at `0xBD3aC7f06F39A3D1E3ac905A57c1CbD067be71f1` in Base block `50412040`.

- Transaction: `0x1984b8d1f2266e3ee3f51343515057fbb496f015126631577562a782f19d16fe`
- Source verification: Sourcify exact match
- WETH: `0x4200000000000000000000000000000000000006`
- Mint Club Bond: `0xc5a076cad94176c2996B32d8466Be1cE757FAa27`
- Uniswap Onchain Router: `0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02`
- GETHYPED fee: `0%`
- Successful executor reward: `20%` of realized Reserve Token profit

The user approves and receives the market's Reserve Token. WETH is only an internal routing asset when required. The contract has no owner, guardian, upgrade hook, arbitrary external call, or withdrawal function.

## Production configuration

1. Set `NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V3=0xbB7AF71818fD1a269f21D0b5E4d8F7CF5401Ac3C`.
2. Set `ARBITRAGE_EXECUTOR_V3_DEPLOYMENT_BLOCK=50422622`.
3. Store `BASE_RPC_URL` and `ARBITRAGE_RELAYER_PRIVATE_KEY` in the web deployment.
4. Fund the dedicated relay wallet with only enough Base ETH for gas.
5. Run `npm run check:arbitrage` before deployment. The open browser tab checks prices and the server relay submits eligible executions.
6. Use `npm run keeper` outside Vercel only when an optional always-on keeper is deliberately operated with a separate key.
7. Complete one small end-to-end Base strategy before opening the action broadly.

## Release checks

- Verify the deployed source and immutable addresses.
- Confirm both Reserve round trips at one pinned block for each supported market.
- Confirm losing and under-minimum-profit executions revert without changing user balances.
- Confirm stop and exact-allowance revoke work from the Portfolio page.
- Complete an independent security review before increasing real user limits.

## Legacy WETH executors

The WETH-settled executors below are deprecated for new strategies and remain configured only for stop and revoke support.

- First deployment: `0x76C59F1f1CB8A9F1e0b63f16Dc4fceCC83E0A9A4`, block `50262724`
- Patched V1 deployment: `0xDd6aDbBf2c65D19B254d02d2BBF57afc471cdD4e`, block `50304942`

Do not run the legacy keeper during normal operation.
