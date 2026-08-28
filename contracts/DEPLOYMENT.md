# Base deployment record

## V4 migration candidate (deployed, not active)

`HypedArbitrageExecutorV4` is implemented and connected across the application behind a
disabled feature gate. It was deployed and exactly source-verified on Base, but must not
receive production traffic until the remaining canary release gates below pass.

- Contract: `0x6Aad2b4BB89813B4E0Db43170c8b314417B1D571`
- Deployment transaction: `0x307e79c39b5d6caf87ba5c173a75130aa738c92ebea64736f0e39723ecb793a8`
- Deployment block: `50561393`
- Deployer and operator manager: `0x673F0277f9B7Aaebc80A07c199dbF32007455495`
- Trusted relay: `0x7dB6BDD7e852f5eF45260b0e5D087aE9fdf85c3C`
- Source verification: Sourcify creation and runtime exact match
- Guardian role: none
- Activation: disabled; V3 remains the production executor
- Control-path canary: passed on Base for exact approval, strategy start, stop, and allowance revoke
- Execution canary blocker: the deployer and relay currently hold no supported Reserve Token

Control-path canary transactions:

- Approve `1 wei MT`: `0x3d4334288799b0d48e26a15554de33d1ab01c65f91d72619fb64923ddeca4faf`
- Start strategy `#1`: `0x2e0e1225588213ce65a2056e7793775c603e1d618308ed2eaf8c3539115e1eaf`
- Stop strategy `#1`: `0x30c46be9914a77a83c6cd36b5b629c8a2236f4943415a882738084c8639069ec`
- Revoke allowance: `0x6cd28924911bfcca88752ffe1e7e2af22a1dd899bfb837d74ccae356f56bea1e`
- Final state: `activeStrategyId = 0`, V4 MT allowance `= 0`

The binding objective, compatibility policy, release gates, rollback rules, and prohibited
shortcuts are defined in [`../docs/ARBITRAGE_V4_MIGRATION.md`](../docs/ARBITRAGE_V4_MIGRATION.md).
V4 remains a candidate until every gate in that document passes.

V4 changes the execution policy in four deliberate ways:

- The router may select a direct pool or a multihop pool instead of forcing WETH as an intermediate asset.
- Base L2 execution, L1 data publication, and operator fees are reimbursed first; 10% of the remaining profit is the executor incentive.
- The relay fee claim is capped by the Base onchain upper bound and by the user's explicit Reserve reimbursement limit.
- The owner's absolute and percentage minimum profits are checked after every execution cost.
- Mint routes consume only the Reserve amount actually spent from the cumulative strategy budget.
- Active permissions are keyed by wallet and Hyped Token, allowing separate markets that share one Reserve Token.
- Relay rotation is a two-step handoff. A narrow manager pause cannot block user stop actions.

L1 data cost is required for Base profitability accounting because every Base transaction pays to publish compressed transaction data to Ethereum. V4 does not pass calldata to `getL1Fee(bytes)`. That method requires a fully serialized transaction. Instead, preflight uses the complete transaction estimate offchain and the contract validates the submitted reimbursement against `getL1FeeUpperBound(uint256)`, L2 gas, and the operator fee.

Migration must be explicit:

1. Complete an independent review of the V4 bytecode, Base fee assumptions, and role addresses.
2. Keep the deployed V4 relay funded and the narrow operator manager separately controlled from it.
3. Run the full contract suite and a small capped Base end-to-end strategy against the deployed bytecode.
4. Add V4 application configuration without removing the V3 address or deployment block.
5. Create new strategies on V4 while keeping V3 reads, stop actions, and allowance revocation available.
6. Switch public automation only after relay and UI status agree on the same simulated after-cost result.
7. Increase limits only after a canary period confirms fee reimbursement, budget accounting, stop, and key rotation on Base.

Do not point the current V3 application ABI at V4. Existing V3 permissions must never be silently migrated.

## Ordered V4 release

The order below is binding. Do not push the V4 activation commit before the verified
contract address and deployment block exist in the connected deployment environment.

### 1. Verify locally and against Base

```sh
cd contracts
forge fmt --check
forge test -vv
forge test --fork-url "$BASE_RPC_URL" \
  --match-contract HypedArbitrageExecutorV4BaseForkTest -vv
forge build --sizes
```

This gate proves the contract policy, real Base dependencies, both live HMT routes,
Base fee conversion, stop while paused, fee caps, and protected user return. It does not
authorize a production deployment by itself.

### 2. Prepare separate roles

- `ARBITRAGE_RELAYER_ADDRESS`: dedicated execution wallet derived from the relay key.
- `ARBITRAGE_V4_OPERATOR_MANAGER`: separately controlled manager, preferably a multisig;
  it handles two-step relay rotation and emergency pause.
- `ARBITRAGE_DEPLOYER_ADDRESS`: the public deployment address, when a deployment helper needs it.

The relay and manager must be separate operational roles. The manager cannot withdraw
tokens, edit user strategies, or change fixed economics. The V4 deployment deliberately
uses the previous V3 deployer as the manager and keeps the relay separate. Private keys
remain only in the ignored local environment and deployment platform secrets.

### 3. Deploy V4 to Base (complete)

The deployment reused the ignored local key that deployed V3. Before submission, the
script derived only its public address, matched it to the V3 deployment transaction,
estimated the Base fee, checked the balance and predicted address, and kept the key out
of output and process arguments. The resulting V4 address and source match are recorded
above.

### 4. Configure without activating

Set the following in the connected Vercel project while keeping the feature gate off:

```text
NEXT_PUBLIC_ARBITRAGE_EXECUTOR_V4=<verified address>
ARBITRAGE_EXECUTOR_V4_DEPLOYMENT_BLOCK=<deployment block>
NEXT_PUBLIC_ARBITRAGE_V4_ENABLED=false
```

Keep the V3 address and block configured for existing strategy reads, stop, revoke, and
history. Run `npm run check:arbitrage` locally with the prospective V4 values and confirm
the bytecode, immutables, roles, pause state, Base fee oracle, and relay balance.

### 5. Run the Base canary

Use one allowlisted wallet and a deliberately small budget. Confirm start, one rejected
after-cost execution, one profitable execution, confirmed history, stop, and allowance
revoke. The Markets row, detail page, Portfolio, relay response, and transaction event
must report the same state.

### 6. Start the persistent V4 keeper

Run `npm run keeper:v4` on an always-on host outside Vercel. The keeper holds no key; it
calls the canonical relay endpoint, which performs a fresh assessment before signing.
Confirm that automation continues after the user closes the browser.

### 7. Activate through GitHub

Set `NEXT_PUBLIC_ARBITRAGE_V4_ENABLED=true`, run the full application checks, commit the
reviewed migration, and push to `main`. The connected Vercel project deploys that GitHub
commit. Do not run a local Vercel production deploy.

### 8. Observe and expand

Keep new V3 starts disabled. Observe a canary period before increasing user limits.
V3 remains visible for recovery until all V3 strategies and allowances are drained.

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

The user approves and receives the market's Reserve Token. WETH is only an internal routing asset when required. The contract has no owner, upgrade hook, arbitrary external call, or withdrawal function.

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
