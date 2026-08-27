# GETHYPED design rules

## Global alignment

- Every top-level page uses the same left and right alignment as the global header.
- Header, home, inner pages, pool workspace and footer must use `--layout-max` and `--layout-gutter` from `app/globals.css`.

## Product terminology

- Use `Create a pool` for the primary creation action and navigation. Do not use `Launch` in user-facing copy.
- Use `Hyped Token` for the product type. Do not use `h-token` in user-facing copy. Token symbols such as `hMT` remain unchanged.
- Present the creation flow as `OG token → Hyped Token → Pool`.
- Internal routes, filenames, data types and contract identifiers may retain `launch` and `hypedToken` so wording changes do not destabilize working code.
- Do not introduce a separate page-level width such as 1080px for individual routes.
- Content inside the shared container may use a smaller `max-width` for readability, but the page container itself must retain the global alignment.
- New pages must use `.page-shell`. Full home sections use `.home`; both resolve to the same layout tokens.

## Runtime and Vercel

- Keep the website and the arbitrage executor as separate runtimes. Vercel serves the interface and short request-response APIs; the persistent executor runs outside Vercel.
- Refresh the public price-gap view every 30 seconds only while its browser tab is visible. Refresh once immediately when the tab becomes visible or focused again.
- Reuse identical public executable quotes for 15 seconds across visitors. The cache key must include the token and the user's bounded execution budget.
- Never share-cache wallet balances, approvals, authorizations, portfolio snapshots, transaction preparation or execution state.
- While an authorization is active, refresh its private status every 30 seconds only in a visible tab and once when the tab is focused. The executor, not this status request, determines execution timing.
- The executor may check routes more frequently than the interface because it decides whether a signed authorization can execute. UI refresh frequency must never be treated as the execution-monitoring frequency.
- Keep historical chart source data on its existing daily refresh. Do not route GeckoTerminal embeds through a Vercel Function.

## Typography

- Use the typography tokens in `app/globals.css`; do not add arbitrary font sizes.
- Use sentence case for interface copy. Keep uppercase only for GETHYPED, token symbols and technical acronyms.
- Text must not be smaller than `--text-meta`, except chart axes using `--text-axis`.
- Reserve `--text-display` for the home hero. Inner pages use one page title and one concise lead.

## Visual hierarchy

- Use restrained green as the live, positive and primary-action accent. Reserve amber and red for waiting and failure states. Neutral surfaces must remain visually dominant.
- Use a near-black financial workspace, layered charcoal surfaces and quiet green-tinted borders. The interface should feel like a focused market terminal, not a marketing card collection.
- Structure information as identity, live state, key metrics, chart or table, then action. Prefer dense aligned rows and compact data cells over decorative containers.
- Prefer spacing and typography over nested cards, borders and badges.
- Keep primary actions visually dominant and hide supporting explanations behind a refined details control when appropriate.
- Token and market visuals must use real contract-backed data and real token logos. Never seed mock market or portfolio data.
- Market lists expose `Arbitrage` as the primary product action. Buy and Sell remain one click away in the market detail Trade tab.
- Keep the Markets table to `Market`, `Price`, `Market cap`, `Backing` and `Action`. Price is the current executable buy price, and market cap is current supply multiplied by that price. Never substitute a fabricated USD value when a live conversion is unavailable.
- Prefer user language such as `Backing`, `Buy`, `Sell`, `You pay` and `You receive`. Keep protocol terms such as `bond`, `mint`, `burn`, `royalty` and route internals out of the primary interface unless a technical disclosure requires them.
- Fees must remain discoverable before signing but should live in a collapsed `Price details` disclosure rather than compete with the trade action.

## Network identity

- Chain selection is implementation detail, not a top-level user task. Do not split Markets, Portfolio, Create a pool or Security into network tabs.
- Read every supported network in parallel and present one truthful asset or system view. A failed network must not hide successful reads from another network.
- Identify an asset's network with the official compact chain mark overlaid at the token logo's lower-right corner. Do not repeat the chain name in primary table copy.
- Detect the network from the entered contract address in Create a pool. Ask the user to choose only when the same address resolves to a valid contract on more than one supported network.
- Keep the selected chain in the route and transaction manifest. Reveal the chain name when it materially affects signing, explorer links or a wallet network switch.
- Never create placeholder assets to make a network look populated. An empty network remains invisible until a real, verified asset exists.

## Market detail

- Open market detail in `Arbitrage` mode. The first screen compares the two live executable routes and places its single authorization action beside the result.
- Use one pair title such as `MT ↔ hMT` instead of repeating separate asset cards. Pair it with the concise proposition `One original token. Two connected market prices.`
- The Markets directory may show only whether a standard-size route exists after price impact, exchange fees and the successful-executor reward. Do not show large pre-gas percentages in the directory; gas, wallet balance, allowance and simulation are checked on the market page.
- Show `Ready` or an executable profit only from the relay assessment for the user's exact amount. Active automation must never fall back to a public pre-gas quote when the relay assessment is missing or waiting.
- Show only the strongest currently checked direction in plain token notation. Keep the alternate direction, venue versions, allowances and other route internals out of the primary result or in disclosures.
- A price-gap result must come from current executable Uniswap and Mint Club quotes at the user's entered Reserve Token amount. Show amount in, amount returned and the user's net after exchange fees and the successful-executor reward. State that gas is verified at execution; never claim gas is already deducted from the quote.
- Pin every leg, fee read and limit read in one displayed opportunity to the same block. Show that block and the quote time so a historical chart or an older response can never be mistaken for the current execution decision.
- Keep public live-quote response fields backward compatible across rolling deployments so an already-open market tab cannot turn a valid opportunity into a false negative after the server updates.
- If neither checked direction returns a positive user amount, say `No net-positive route.` Do not turn historical normalized movement into an arbitrage signal.
- Use the crossed historical OG and Hyped Token price chart as the primary visual. Label it as historical movement and explain that line separation is only what prompts a live profitability check.
- Use the current same-block executable quote after price impact, fees and executor reward as the only source for the opportunity percentage, estimated profit and execution decision. Historical line distance never determines whether arbitrage is available.
- Connect only real observed OHLCV closes with straight segments. Do not smooth, interpolate or manufacture intermediate market data.
- Use one visible three-part toggle with equal-width `Arbitrage`, `Trade OG` and `Trade Hyped Token` buttons. Do not hide these destinations in a dropdown or add a redundant `View` label. This single control changes the explanation, chart and action panel together.
- Do not add a second page-face selector or repeat an OG/Hyped Token toggle inside the content. One visible view control is the complete navigation model for market detail.
- Use one full-size dark Arbitrage workspace with a single divider between comparison and action. The comparison and action surfaces share one restrained terminal palette; green marks the selected state, live data and primary action.
- Make task order explicit with `1. Check profit`, `2 · Execute` and `3. Position history`. The current profit state is the primary result, followed by the historical price comparison, the compact arbitrage path and the exact returned Reserve Token amount.
- Keep the pair header to the token pair and the single three-part view toggle. Remove repeated network, product-proposition, normalization, fee and gas helper sentences from the primary surface; retain necessary disclosures in source links or the existing settings accordions.
- Align `1. Check profit` with the action panel step label. Keep the live percentage as the only large result in that header.
- Label the route `Arbitrage path`. Display the visual path as seven equal slots including arrows: Reserve Token amount, arrow, Hyped Token, arrow, swap, arrow, returned Reserve Token amount. Keep explanatory text in `Details`.
- Give the primary form one Reserve Token amount and one `Execute arbitrage` action. Treat the amount as the per-run size, set the repeat limit automatically, and after signing show only `Watching` and `Stop`.
- Read the connected wallet's actual Reserve Token balance and permission. State this beneath the amount without introducing a separate asset selector.
- Put route protection, costs and permissions in one collapsed `Details` disclosure so supporting text never competes with the primary action or overflows the action stage.
- Use whitespace as state capacity, not as a prompt to add permanent copy. A thin leader line may connect the price-check step to its result; the lower comparison area remains empty until a real execution can show its used amount, return, profit and transaction link; the lower action area is reserved for open settings and post-authorization controls.
- In the primary Arbitrage result, use one status title above the chart. Do not repeat checked state, price-gap state and route interpretation as separate sentences. Keep block numbers and executor economics inside disclosures.
- In Trade mode, show the selected token's official GeckoTerminal chart and its matching Buy/Sell form together. The top-level mode navigation controls the selected token.
- Keep Arbitrage and both Trade surfaces aligned to the same outer position. Let the Arbitrage surface use a stable compact minimum height instead of stretching its action card into empty space. Remove repeated identity and market-detail cards from the primary Trade column; the selected mode, pair heading and chart already establish context.
- In Trade mode, allocate roughly 72% to the official chart and 28% to the matching Buy/Sell form on desktop; stack them on narrow screens. Do not create unsupported chat or recommendation content to imitate another product's layout.
- Trending tokens are a secondary shortcut under the Create a pool contract input, never a separate destination or primary action. Show only live provider-ranked Base and Robinhood assets, cache reads briefly, verify the selected contract onchain, and never substitute sample data when the source is unavailable.
- Market detail omits the global footer. Arbitrage and Trade are separate faces of the same workspace; do not append a second historical comparison chart below them.
- Each asset view has one identity, one official GeckoTerminal chart and one matching Buy/Sell action.
- Use the official GeckoTerminal Embed for candles, chart tools, ranges and indicators. Do not rebuild its market chart with custom SVG paths, captured arrays, generated points or screenshots.
- Pass the selected asset's real contract address directly to GeckoTerminal's official token Embed. GeckoTerminal selects and identifies the live venue inside its chart.
- Keep a direct GeckoTerminal source link above the chart. The primary chart data loads directly in the GeckoTerminal iframe, outside the application server and Vercel function budget.
- Buy the OG through an official Uniswap API route using native ETH as exact input. The server fixes the disclosed interface fee at 1%; client input must never set or override the fee recipient.
- Buy or sell the Hyped token through its verified reserve exchange. Always refresh and simulate the executable price before the wallet signs.
- Discover an existing Hyped Token Uniswap pool across V2, V3 and V4 before offering liquidity creation. Any Uniswap path whose first pool starts with the Hyped Token counts as an independent market; never create a duplicate pool merely because the current arbitrage executor cannot use that protocol version.
- Market detail is the primary place to authorize arbitrage; Portfolio is where authorizations and realized profit history are managed.
- `Arbitrage` is available only when both tokens have an executable Uniswap route and the Base executor is live. Protocol versions stay hidden from the primary action. Never imply that a profitable opportunity currently exists merely because a route is eligible.
- Market discovery is background verification, never a user-facing destination. A registered eligible market opens directly on `Join arbitrage`; do not show `Checking` or `Market found` as terminal states.
- Keep the primary Arbitrage form free of settings beyond its Reserve Token amount. The amount is the per-run size; the repeat limit is automatic and capped by wallet balance. WETH is internal only. Keep route details in `Details`.
- Wallet confirmations remain explicit security boundaries. One product action may guide the user through required wallet confirmations, but the interface must never imply that signatures can be bypassed.
- After activation, replace the form with `Watching`, amount left and one `Stop` action. Never expose end-time or cumulative-limit controls on the primary surface.
- Use `Arbitrage` in primary copy. Explain it as comparing two executable routes across the OG market, Mint Club conversion, and Hyped Token pool. Reserve `keeper`, `allowance`, and low-level route internals for supporting disclosures.

## Pool creation pricing

- Every new Hyped Token uses one system-owned `$1M` maximum reserve target. Do not ask the user to enter a starting price, ending price or target amount.
- Keep the automatic curve shape consistent: exponential, 100 price steps, a 1,000× final-to-initial price ratio, zero creator allocation and the current default supply unless the user deliberately opens advanced settings.
- Calculate the curve from the selected OG token's attributed live USD price, then sum the exact discrete step arrays produced by the official Mint Club SDK. Never estimate the maximum reserve from an average price or fabricate a USD value.
- Select the most liquid attributed GeckoTerminal pool yourself and require at least `$10,000` of reported pool liquidity before it can price a `$1M` pool. A smaller source may be displayed during token analysis but cannot set the signed curve.
- Re-read the OG price and total supply during Review, recalibrate on the server and persist those exact values before wallet signing. The transaction must use the persisted reviewed configuration.
- Compare every reviewed Mint Club range and price step with the wallet transaction arguments immediately before simulation and signing. Any mismatch returns the user to Review.
- If an attributed USD price is unavailable, the OG supply value is below `$1M`, or reserve-token precision cannot represent the target within tolerance, stop pool creation with one direct error. Do not silently fall back to manual or sample pricing.
- Keep the primary pricing form to token identity. Put supply, price steps, allocation and fees in `More settings`; any change recalibrates the same `$1M` target automatically.
- Show the resulting price range, actual OG backing amount and verified USD maximum in the Hyped Token preview. Do not add explanatory copy about target reserves or upfront reserve requirements.
