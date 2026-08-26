# Security policy

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability that could put user approvals, funds, API credentials or executor keys at risk.

Send a private security advisory through the repository's **Security** tab with:

- affected contract, route or component;
- reproduction steps;
- expected and observed behavior;
- possible impact;
- a suggested fix, if available.

Do not include live private keys, seed phrases or unrestricted API credentials.

## Secrets

- `.env.local` is ignored and must never be committed.
- `ARBITRAGE_RELAYER_PRIVATE_KEY` belongs only in the web deployment and must use a dedicated low-balance gas account.
- `ARBITRAGE_KEEPER_PRIVATE_KEY` belongs only on the persistent keeper host.
- Never reuse the relay and keeper keys.
- Keep `ARBITRAGE_RELAY_DAILY_GAS_WEI` low enough to bound one deployment instance's daily gas use.
- Use dedicated accounts funded only for gas.
- Uniswap and RPC credentials remain server-side.
- Rotate any credential immediately if it appears in logs, screenshots, commits or support messages.

## Contract boundaries

`HypedArbitrageExecutorV3` is immutable and has no owner, guardian, upgrade, arbitrary-call or withdrawal surface. It receives user funds only during an atomic execution and must return the Reserve Token principal plus the protected result in that transaction.

Before increasing production limits:

1. Independently review the deployed bytecode and immutable addresses.
2. Re-run unit and Base fork tests.
3. Test start, repeated execution, stop and allowance removal with a small amount.
4. Confirm keeper gas economics for every supported Reserve Token.
5. Commission an independent smart-contract security review.

## Supported versions

Only the current `main` branch and the V3 Base deployment documented in `contracts/DEPLOYMENT.md` are intended for new continuous permissions. V2 and legacy contracts remain available only to inspect and revoke earlier permissions.
