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
- Live assessment canary: invalid; an RPC-backed check was misclassified as `no-profitable-route`
- Reliable rejection canary: pending a complete fresh quote that proves the exact blocked reason
- Latest Base fork execution canary: passed with retained MT through `Buy then redeem`
- Profitable execution canary: passed live through `Buy then redeem` with protected owner profit
- Public RPC gate: passed with batched latest-state quote, simulation, submission, and receipt fallback

Control-path canary transactions:

- Approve `1 wei MT`: `0x3d4334288799b0d48e26a15554de33d1ab01c65f91d72619fb64923ddeca4faf`
- Start strategy `#1`: `0x2e0e1225588213ce65a2056e7793775c603e1d618308ed2eaf8c3539115e1eaf`
- Stop strategy `#1`: `0x30c46be9914a77a83c6cd36b5b629c8a2236f4943415a882738084c8639069ec`
- Revoke allowance: `0x6cd28924911bfcca88752ffe1e7e2af22a1dd899bfb837d74ccae356f56bea1e`
- Final state: `activeStrategyId = 0`, V4 MT allowance `= 0`

Invalid live assessment canary (funds safely cleaned up):

- Budget acquired: `1054.924057473303162625 MT` for a `0.00095 ETH` capped buy
- Approve exact MT: `0x7a3d97339439b8ddaee2a1e51fff981b670447d420b24432fd8153e47993636a`
- Start strategy `#6`: `0x727b9de2834b237f1db8ed083f04593e26b60762e3b0a2831ac2fdc206bbf726`
- Relay response: `no-profitable-route`; later review found that quote/RPC failures could
  collapse into this code, so the response does not prove that no profitable route existed
- Stop strategy `#6`: `0x736f1f8cdb5412c7cb6a05ed00eae4507372ad87fecd5a6cfcd83a8e35c4e09f`
- Revoke allowance: `0x241f760e2edbcd028467610fc2e6725e2ec6be04057d1211b8c528dff642e3e5`
- Final state: `activeStrategyId = 0`, V4 MT allowance `= 0`, acquired MT remains in the owner wallet

Before another live canary, the relay must return `quote-unavailable` for any incomplete
price, route, simulation, or fee read. `no-profitable-route` is valid only when both route
searches complete, while `fees-higher-than-profit` requires a complete candidate and fee
assessment. The rerun uses ordered public RPC endpoints and the same direct router path as
the V4 contract.

Latest Base fork execution canary:

- Fork block: `50680838`
- Budget: `1054.924057473303162625 MT`
- Direction: `Buy then redeem`
- Fee reimbursement claim: `0.000005 ETH`, below the contract's Base fee upper bound
- Result: owner retained positive MT profit, relay received reimbursement and incentive,
  remaining strategy volume became zero, and allowance became zero
- Scope: isolated fork only; no production transaction was submitted

Correctly classified public-RPC canaries (funds safely cleaned up):

- Strategy `#7`: exact approval and start succeeded; PublicNode assessment returned
  `quote-unavailable`; stop and revoke succeeded.
- Strategy `#7` approve/start/stop/revoke: `0x48dd8d6ea7fba31d4dc9c8a4fcf7b73fa5716d6ce407620e1627c26fb8201e77`,
  `0x41d26d5c523b0217954e12ac2b5eff928a15bda641e239ef290ec55363014596`,
  `0x1bef989c63a125fa12177866a1709bf7c331d547d24c80f0f1e3bcbefc70a9a1`,
  `0x743ec1cdd98529c17929e9f3c4916d3b6a4e2735a9ea79df462db11a7e6b6bee`.
- Strategy `#8`: exact approval and start succeeded; Base public RPC rate-limited the
  assessment; Blast cleanup restored zero strategy and zero allowance.
- Strategy `#8` approve/start/stop/revoke: `0xa8362d1db0b022000cd933c728cef4590fc7e0388e6086d18210c3a9bf862f81`,
  `0xeef17fd60f8781beb163e68b04f8bfaefa51585bd6fc2f84b164e3053ff21d0c`,
  `0x1d291ef563d6384fa466c0ae455e2d7721728c92d2207e2bf78423feb5bda806`,
  `0x691d19a1dc9a3e02809c6165bfc149cc9f8a5a4dd42093d9404d0820b7b94aa3`.
- Strategy `#9`: relay preflight passed after multicall and ordered fallback were added,
  but all three bounded assessment attempts returned `quote-unavailable`.
- Strategy `#9` approve: `0xc3a07785e9f189e0606b4ca1d470ceb3941dd7f5d84ea0f7b1cdf21de89713b3`
- Strategy `#9` start: `0x5a13e9d43f000a3802a06a6f645671be34d60dc4d8c33387c878f0595a64da28`
- Strategy `#9` stop: `0x12620eceabe7879a340292d5da963a45d76995eec58e116baa566957325c5066`
- Strategy `#9` revoke: `0xe81e46ef7433dee5c655d0ce9d13311c1415ad2e3e82109d9ef66359e310fd3f`
- Final cross-check at Base block `50681672`: active strategy `0`, V4 MT allowance `0`,
  MT balance `1054.924057473303162625`, strategy `#9` execution count `0`.

These are infrastructure canaries, not economic rejection canaries. They prove that an
incomplete assessment is no longer shown as `no-profitable-route` or `fees-higher-than-profit`.
They do not satisfy the live profitable or complete rejection release gates. Subsequent
review found two avoidable causes of load: V4 assessment reused V3's forced WETH route and
searched each amount sequentially. The relay now quotes the contract's direct router call,
batches parallel candidates, and uses only explicitly configured public fallbacks. A latest
Base smoke test completed both nine-size directions and Mint Club conversions in one batched
search without a private endpoint. PublicNode may reject fixed historical fork reads as
archive access; that limitation affects fork reproduction, not latest production quotes.

Public-RPC live execution canary:

- Strategy `#10` safely exposed the first V4 route mismatch after direct quoting was added;
  it returned `quote-unavailable`, then stopped and revoked without execution.
- Strategy `#11` exposed `FeeClaimExceedsUpperBound` being hidden by an incomplete ABI and
  incorrect error precedence; it also stopped and revoked without execution.
- Strategy `#12` used the decoded contract fee ceiling, completed `Buy then redeem`, and
  closed atomically at Base block `50682907`.
- Approve: `0xc49a6c9cd2ac2066f7685be138379f0310f0c06acdf1870646c7c4180d7f8715`
- Start: `0xb7f5ddff4520ee2f1b8d077db911aa1d0d04d904fd4e0cc008a27a652f03189c`
- Execute: `0x07d634bc58d4a9da0389ba56fd212f549877b052e5c2f1c6eeb5d19983e87c8b`
- Amount spent: `1054.924057473303162625 MT`
- Gross profit: `15.652094898952154784 MT`
- Gas reimbursement: `0.019652812714718933 MT`
- Executor incentive: `1.563244208623743585 MT`
- Protected owner profit: `14.069197877613692266 MT`
- Final owner balance: `1068.993255350916854891 MT`
- Final state: active strategy `0`, V4 MT allowance `0`, remaining volume `0`, execution count `1`

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
BASE_RPC_URL=https://base-rpc.publicnode.com
BASE_RPC_FALLBACK_URLS=<ordered public Base fallbacks>
```

Keep the V3 address and block configured for existing strategy reads, stop, revoke, and
history. Run `npm run check:arbitrage` locally with the prospective V4 values and confirm
the bytecode, immutables, roles, pause state, Base fee oracle, and relay balance.

### 5. Run the Base canary

Use one allowlisted wallet and a deliberately small budget. Confirm start, one rejected
after-cost execution, one profitable execution, confirmed history, stop, and allowance
revoke. The Markets row, detail page, Portfolio, relay response, and transaction event
must report the same state.

### 6. Start the V4 watcher

The application itself does not require GitHub Actions. Enable the scheduled watcher only
when automation must continue after the user closes the browser. It was added for that one
purpose, holds no key or RPC secret, reads Base through public endpoints, and calls the
canonical relay only when an active strategy exists. The relay performs a fresh assessment
before signing. Keep repository variable `ARBITRAGE_V4_WATCHER_ENABLED` unset or `false`
until V4 activation, then enable it with:

```sh
gh variable set ARBITRAGE_V4_WATCHER_ENABLED --body true
```

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
