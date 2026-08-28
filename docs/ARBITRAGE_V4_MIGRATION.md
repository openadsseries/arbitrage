# Arbitrage V4 migration

Status: pre-deployment gate

## Why V4 exists

V4 is not a cosmetic contract upgrade. It fixes one product-level accounting problem:
GETHYPED must never call a route an opportunity, start it, or record profit unless the
user keeps a protected net profit after every execution cost.

V3 pays the executor a fixed share of gross Reserve Token profit. That can underpay a
small execution, overpay a large one, and does not prove that Base L2 gas, Ethereum L1
data publication, operator fees, slippage, and the user's minimum return all fit inside
the same trade. V4 reimburses a bounded real execution cost first, then shares only the
remaining profit. The transaction reverts unless the user's absolute and percentage
profit floors still hold.

The product objective is therefore:

```text
confirmed user profit
= returned Reserve Token - spent Reserve Token
- Base L2 execution fee
- Ethereum L1 data fee
- Base operator fee
- executor incentive
```

Mint Club costs, external-pool fees, price impact, and slippage are already reflected in
the atomic route result. A route is executable only when the final value above remains
inside the user's limits.

## Non-negotiable product rules

1. `Route available`, `Estimated return`, `Ready`, and `Executed` are different states.
2. A positive pre-cost percentage is never labelled profit or an opportunity.
3. Markets uses one exact `$10` comparison amount. If reliable USD pricing is missing,
   the comparison is `Unavailable`.
4. Automation optimizes within the user's approved budget. Its amount may differ from
   the Markets `$10` benchmark.
5. Markets, market detail, automation, relay, keeper, and history consume one canonical
   after-cost assessment contract. They may present different detail, not different truth.
6. Relay and keeper re-simulate fresh state immediately before submission.
7. Confirmed V4 events are the only source of realized return and PnL.
8. A relay outage, missing role, insufficient relay ETH, stale quote, high fees, missing
   allowance, or insufficient liquidity is shown as its real state. It is never replaced
   by `Watching`, `Route found`, or a positive percentage.
9. New strategies use V4 only after every release gate below passes.
10. Existing V3 strategies are never silently migrated. They remain visible and can be
    stopped and revoked until the V3 balance and permission surface is drained.
11. Deployment is contract first, configuration second, canary third, and GitHub
    activation last. A local Vercel CLI deployment is not part of this release path.

## One source of truth

The application must normalize version-specific chain data into one internal model:

```text
ArbitrageAssessment
  identity: chain, owner, hToken, reserveToken, executorVersion
  quote: purpose, exact input, direction, expected return
  costs: route costs, Base total fee, safety margin, executor incentive
  result: user net return, user net profit, net return bps
  readiness: route, liquidity, allowance, relay, fee, freshness
  state: unavailable | no-route | estimated | blocked | ready | submitted | confirmed
  evidence: block number, quote time, transaction hash
```

The assessment implementation owns all state names and calculations. UI components may
format it but must not recompute profitability. API routes may cache it but must not
change its meaning. The relay and keeper may execute only the exact `ready` assessment
after a fresh simulation.

## Version policy

| Surface | V3 during migration | V4 after canary |
| --- | --- | --- |
| Create strategy | Disabled for new strategies | Primary |
| Read active strategy | Supported | Supported |
| Stop strategy | Supported | Supported |
| Revoke allowance | Supported | Supported |
| Execute strategy | Drain only; no new activation | Primary |
| Confirmed history | Merged and tagged internally | Merged and tagged internally |

Executor versions are an implementation detail in normal UI. They appear only in
diagnostics, transaction links, and migration support.

## Release gates

V4 must not receive production traffic until all gates pass in order:

1. **Contract**: unit tests, invariant-sensitive edge cases, bytecode size, and source
   verification inputs pass.
2. **Roles**: a dedicated funded relay is `trustedExecutor`; a multisig or separately
   controlled account is `operatorManager`. The manager handles two-step relay rotation
   and emergency pause without receiving withdrawal or user-strategy powers.
3. **Base fork**: deploy V4 against the real Base WETH, Mint Club Bond, Base Gas Price
   Oracle, and external router; prove both directions, high-fee rejection, stale-route
   reversion, stop while paused, and exact budget accounting.
4. **Application**: V4 ABI, events, reads, writes, relay, keeper, Portfolio, market detail,
   and Markets all use the normalized assessment. V3 recovery remains intact.
5. **Readiness**: deployed bytecode and immutable addresses match; roles and pause state
   match; relay balance is sufficient; a live fee quote includes L1 and L2 fees.
6. **Canary**: one allowlisted wallet completes a deliberately small strategy, one stop,
   one revoke, and both a profitable and a rejected execution without inconsistent UI.
7. **GitHub preview**: production environment variables are present before the commit is
   promoted. Preview smoke tests cover Markets, detail, Portfolio, wallet connection,
   start, blocked state, stop, and confirmed history.
8. **Production**: merge through GitHub so the connected deployment builds that commit.
   Do not deploy the application with a V4 ABI before the verified V4 address is configured.

Any failed gate stops the release. Passing an earlier gate does not waive a later one.

## Rollback

- The operator manager may pause new V4 starts and executions. Users must still be able
  to stop and revoke permissions while paused.
- Application rollout keeps V3 and V4 addresses separately. A rollback never points a
  V3 ABI at V4 or a V4 ABI at V3.
- Before broad release, a feature gate can disable new V4 starts without hiding existing
  V4 positions or confirmed history.
- After V4 canary begins, V3 remains recovery-only. A rollback does not create new V3
  strategies unless an explicit security decision documents why.

## Mistakes this migration must not repeat

- Do not infer executable profit from a one-token price gap.
- Do not use `Route found` as a success state.
- Do not let Markets and detail quote different amounts under the same label.
- Do not omit Base L1 data cost from fee checks.
- Do not let UI state, local storage, or optimistic messages create PnL.
- Do not poll a heavy relay simulation merely to display a market row.
- Do not deploy through a local Vercel CLI. Production deploys come from the reviewed
  GitHub commit and the connected Vercel project.
- Do not retire V3 reads, stop, or revoke paths while a V3 strategy or allowance remains.

## Definition of done

The V4 migration is complete only when a user can start once, leave the browser, have a
persistent keeper execute whenever a fresh after-cost assessment is `ready`, see the same
state on every page, receive protected Reserve Token profit, and stop or revoke without
operator cooperation. Until then, V4 is a candidate rather than the production executor.
