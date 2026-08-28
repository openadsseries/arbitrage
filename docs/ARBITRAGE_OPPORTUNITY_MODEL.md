# Arbitrage Opportunity Model

Status: Research draft

The binding implementation and release rules live in
[`ARBITRAGE_V4_MIGRATION.md`](./ARBITRAGE_V4_MIGRATION.md). This document explains the
research behind those rules; it does not override the migration gates.

## Product objective

GETHYPED should detect and execute economically real arbitrage between a Mint Club market and an external market. A positive percentage alone is not an opportunity.

```text
user net profit
= returned reserve - input reserve
- Mint Club costs
- external-market fees
- price impact and slippage
- execution cost
- safety margin
```

An opportunity exists only when the final user net profit is positive and meets the user's minimum return.

## Two different quote purposes

### Market comparison

- Compare every market using an exact USD benchmark, initially $10.
- Show `Unavailable` when a reliable USD price is unavailable.
- Never present a pre-cost price gap as executable profit.

### Automation search

- Search every viable size up to the user's approved budget.
- Optimize final user net profit after all costs, not percentage return.
- Revalidate the selected size and route immediately before execution.

## Confirmed root changes

1. Markets compares the result of an exact $10 trade.
2. Quote APIs separate exact-amount assessment from budget optimization.
3. The optimizer refines profitable intervals beyond the current fixed samples.
4. Markets, market detail, and automation consume one after-cost assessment model.
5. Route selection compares direct and WETH-routed execution at minimum.
6. Automation requests relay verification immediately when the executable threshold is crossed.
7. The executor reimburses bounded execution cost first, then splits remaining profit while protecting the user's minimum net return.
8. Active strategies are keyed by owner and Hyped Token, not only by owner and Reserve Token.

## Additional requirements for small opportunities

9. A continuously available watcher must detect opportunities when the user's browser is closed.
10. Readiness, discovery, and execution must use the same route engine and supported route set.
11. Position sizing must search Mint Club step boundaries and route-change boundaries using after-cost profit.
12. Execution must use a fresh same-state simulation, stale-quote rejection, and opportunity-aware slippage limits.

## Honest scope

These changes can make discovery and execution reliable within the supported tokens, markets, and route engine. They cannot guarantee capture of every opportunity because block competition, state changes, MEV, RPC failure, and temporary relay unavailability remain external constraints.

## Working definition

Classical arbitrage is the near-simultaneous purchase and sale of the same or economically equivalent asset at different prices. The idealized trade locks in a price difference, but real execution still has settlement, ordering, liquidity, latency, and fee risk.

For GETHYPED, an arbitrage opportunity is narrower:

1. The route starts and ends in the same Reserve Token.
2. Every step can settle atomically or the whole transaction reverts.
3. The route is simulated against fresh onchain state.
4. The returned Reserve Token exceeds the input plus every explicit and implicit cost.
5. The remaining user profit exceeds the configured minimum and safety margin.

A route, a price gap, and a profitable opportunity are therefore different states:

- `Route available`: the required markets and contract calls exist.
- `Price gap`: a pre-execution price difference exists at a stated amount.
- `Profitable now`: the fresh route remains positive after all costs.
- `Executed`: the atomic transaction settled and produced confirmed profit.

## How established systems work

### Hummingbot

Hummingbot separates market data, opportunity detection, execution, lifecycle tracking, and performance reporting. Its arbitrage executor checks pair compatibility, profitability including transaction costs, and balances before executing above a configured minimum.

Implication for GETHYPED: discovery, execution, and position history should remain separate responsibilities while consuming the same assessment result.

### CoW Protocol

CoW accepts signed trade intents, groups orders into batch auctions, and lets competing solvers search Coincidence of Wants and external liquidity. The winning combination maximizes user surplus while protecting each order's standalone result.

Implication for GETHYPED: the user's approval should express constraints, not a promise that a displayed route will execute. The executor should choose the best valid route inside those constraints.

### UniswapX

UniswapX uses signed intents and competitive filler auctions. A Dutch auction gradually changes the executable price until a filler can profitably settle the order, using its own liquidity or external routes. Failed execution costs are not passed to the user.

Implication for GETHYPED: executor compensation should be dynamic and bounded by user protection. A fixed percentage is simple, but it rejects small profitable trades when it underpays gas and overpays large trades when it exceeds the execution cost.

### Flashbots

Flashbots searchers submit ordered, atomic bundles to builders. A reverted required transaction invalidates the bundle, and bundles can be sent privately or multiplexed to multiple builders.

Implication for GETHYPED: atomicity, pre-submission simulation, private submission where available, and stale-state rejection are execution requirements rather than optional refinements.

## What the research supports

### Route and size optimization

`Optimal Routing for Constant Function Market Makers` shows that routing across multiple CFMMs is a tractable convex optimization problem when fixed execution costs are ignored. Once fixed costs are included, route selection becomes a mixed-integer problem and commonly needs exact search on a constrained route set or practical heuristics.

This directly supports:

- searching trade size instead of quoting only one token;
- comparing multiple route candidates;
- including fixed gas and calldata costs before declaring an opportunity;
- using a bounded candidate graph and refinement search rather than an unnecessarily general solver.

### AMM prices and arbitrage

CFMM research explains that arbitrage trades move reserves and prices toward external market prices. The opportunity shrinks as the trade executes, so the optimal amount is generally finite and state-dependent.

This directly supports optimizing absolute post-cost profit and stopping when the next marginal unit is no longer profitable.

### MEV and failed attempts

`Flash Boys 2.0` documents DEX arbitrage bots, transaction-order competition, and priority gas auctions. `Quantifying Blockchain Extractable Value` shows that revenue must be considered relative to fees and that competition can transfer much of the opportunity to block producers. Recent CEX-DEX measurements also show strong concentration among searchers with better builder integration.

This directly supports:

- fresh block simulation and atomic settlement;
- treating latency and ordering as capture risk;
- not presenting a discoverable price gap as guaranteed profit;
- tracking failed and stale attempts internally even when the user-facing UI stays minimal.

## Assessment of the twelve changes

The twelve changes are directionally correct, with four refinements:

1. The `$10` Markets quote is a comparison benchmark, not the execution amount and not a universal opportunity detector.
2. Route search should compare a bounded route graph, not stop permanently at only direct and WETH routes.
3. Executor reimbursement must be capped and subordinate to the user's minimum net return. It must never turn a user-profitable trade into an executor-only trade.
4. "Any positive amount" is not a safe trigger. Profit must exceed simulation uncertainty, stale-state risk, and an explicit safety margin.

With those refinements, items 1-6 improve discovery and consistency, items 7-8 fix settlement incentives and strategy identity, and items 9-12 improve capture reliability. None alone is sufficient; the product needs the whole sequence from discovery through confirmed settlement.

## Recommended product architecture

### Build now

- One after-cost assessment shared by Markets, Detail, Automation, and History.
- Exact `$10` comparison plus approved-budget optimization.
- Bounded route candidates with adaptive amount refinement.
- Atomic executor with fresh simulation and stale-quote rejection.
- Dynamic, capped executor reimbursement with a protected user minimum.
- Permissionless or continuously available watchers using the same assessment engine.
- Confirmed onchain results as the only source for realized PnL.

### Do not build yet

- A generalized CoW-style solver auction.
- An unrestricted all-token/all-pool graph optimizer.
- Multi-builder infrastructure without evidence that Base execution needs it.
- A database-heavy analytics system before incremental chain caches are insufficient.

These systems are valuable at scale, but they would add operational complexity before improving the current supported-market capture rate.

## References

- Hummingbot, Arbitrage Executor: https://hummingbot.org/strategies/v2-strategies/executors/arbitrage-executor/
- Hummingbot whitepaper: https://hummingbot.org/hummingbot.pdf
- CoW Protocol overview: https://docs.cow.fi/cow-protocol
- CoW fair combinatorial batch auctions: https://docs.cow.fi/cow-protocol/concepts/introduction/fair-combinatorial-auction
- UniswapX overview: https://developers.uniswap.org/docs/liquidity/uniswapx/overview
- Flashbots bundles: https://docs.flashbots.net/flashbots-auction/advanced/understanding-bundles
- Angeris et al., Optimal Routing for Constant Function Market Makers: https://arxiv.org/abs/2204.05238
- Angeris et al., Constant Function Market Makers: Multi-Asset Trades via Convex Optimization: https://arxiv.org/abs/2107.12484
- Angeris and Chitra, Improved Price Oracles: Constant Function Market Makers: https://arxiv.org/abs/2003.10001
- Daian et al., Flash Boys 2.0: https://arxiv.org/abs/1904.05234
- Qin et al., Quantifying Blockchain Extractable Value: https://arxiv.org/abs/2101.05511
- Heimbach et al., Measuring CEX-DEX Extracted Value and Searcher Profitability: https://arxiv.org/abs/2507.13023

## Research questions

- How do established arbitrage and intent systems separate discovery, optimization, simulation, and settlement?
- Which routing and sizing methods are justified by published research?
- How should execution costs and keeper incentives be settled without hiding real user profit?
- Which parts are appropriate for this product without adding unnecessary infrastructure?
