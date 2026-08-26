import Link from "next/link";
import { unstable_cache } from "next/cache";
import { ArrowRight, Database, LockKeyhole, WalletCards } from "lucide-react";
import { LaunchFlowVisual } from "@/components/launch-flow-visual";
import { PriceCoMovementChart } from "@/components/price-co-movement-chart";
import { TokenLogo } from "@/components/token-logo";
import { readArbitrageMarketReadiness } from "@/lib/server/arbitrage";
import {
  readMarketComparison,
  type MarketComparisonState,
} from "@/lib/server/gecko-comparison";

const BNKR_ADDRESS = "0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b";
const HBNKR_ADDRESS = "0x94FF3398d08bb859E0D2CdC7A3F938AA7B109069";
const HMT_ADDRESS = "0x467bA2Da859648dc7C258BcF6572adE499250E6a";
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const readHomeHmtComparison = unstable_cache(
  async (): Promise<MarketComparisonState> => {
    const readiness = await readArbitrageMarketReadiness("base", HMT_ADDRESS);
    return readMarketComparison({
      chain: "base",
      og: readiness.originalMarket.pool
        ? { token: readiness.reserveToken, pool: readiness.originalMarket.pool }
        : null,
      hyped: readiness.hypedMarket.pool
        ? { token: readiness.hToken, pool: readiness.hypedMarket.pool }
        : null,
    });
  },
  ["home-hmt-comparison-v1"],
  { revalidate: 86_400 },
);

function QuoteAssetChoice() {
  return (
    <div className="quote-choice">
      <div className="quote-logos" aria-hidden="true">
        <TokenLogo address={BASE_WETH_ADDRESS} label="WETH" compact />
        <TokenLogo address={BASE_USDC_ADDRESS} label="USDC" compact />
      </div>
      <strong>WETH or USDC</strong>
      <small>Requires route check</small>
    </div>
  );
}

export default async function HomePage() {
  const hmtComparison = await readHomeHmtComparison().catch(() => null);

  return (
    <main className="home page-shell">
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="hero-message">
          <span className="kicker">Connected-market arbitrage</span>
          <h1 id="hero-title">Create the market. Track the gap.</h1>
          <p className="hero-copy">
            GETHYPED creates the paired Hyped Token market, compares both
            prices, and opens the route when an arbitrage gap appears.
          </p>
          <div className="hero-actions">
            <Link className="hero-primary" href="/launch">
              Create a pool <ArrowRight size={15} />
            </Link>
            <Link className="hero-secondary" href="/markets">
              View markets <ArrowRight size={15} />
            </Link>
          </div>
        </div>
        <PriceCoMovementChart hmtComparison={hmtComparison ?? undefined} />
      </section>

      <section
        className="mechanism-section"
        id="mechanism"
        aria-labelledby="mechanism-title"
      >
        <div className="section-lead mechanism-lead">
          <span className="kicker">Why all three venues exist</span>
          <h2 id="mechanism-title">
            Three venues. Two potential arbitrage paths.
          </h2>
          <div className="mechanism-note">
            <strong>The final quote asset requires route validation.</strong>
            <p>
              WETH or USDC can be used only after executable route and liquidity
              checks.
            </p>
          </div>
        </div>

        <div
          className="mechanism-visual"
          aria-label="Three venues complete the quote asset to BNKR, BNKR to hBNKR, and hBNKR to quote asset legs"
        >
          <article className="mechanism-node node-og">
            <div className="node-top">
              <span>01 · Existing OG route</span>
              <em>Quote ↔ OG</em>
            </div>
            <div className="token-pair">
              <QuoteAssetChoice />
              <div className="pair-route">
                <b>↔</b>
              </div>
              <TokenLogo address={BNKR_ADDRESS} label="BNKR" />
            </div>
            <strong className="venue-role">
              Provides the quote ↔ BNKR leg.
            </strong>
            <p>
              Provides the existing market route between the quote asset and
              BNKR.
            </p>
          </article>

          <article className="mechanism-node node-bond">
            <div className="node-top">
              <span>02 · Backing exchange</span>
              <em>OG ↔ Hyped Token</em>
            </div>
            <div className="token-pair bond-pair">
              <TokenLogo address={BNKR_ADDRESS} label="BNKR" />
              <div className="pair-route bond-route">
                <small>Buy →</small>
                <small>← Return</small>
              </div>
              <TokenLogo address={HBNKR_ADDRESS} label="hBNKR" />
            </div>
            <strong className="venue-role">
              Provides the BNKR ↔ hBNKR leg.
            </strong>
            <p>Buy hBNKR with BNKR, or return hBNKR to receive BNKR.</p>
          </article>

          <article className="mechanism-node node-h">
            <div className="node-top">
              <span>03 · Hyped Token pool</span>
              <em>Hyped Token ↔ Quote</em>
            </div>
            <div className="token-pair">
              <TokenLogo address={HBNKR_ADDRESS} label="hBNKR" />
              <div className="pair-route">
                <b>↔</b>
              </div>
              <QuoteAssetChoice />
            </div>
            <strong className="venue-role">
              Provides the hBNKR ↔ quote leg.
            </strong>
            <p>Gives hBNKR an independent secondary-market price.</p>
          </article>

          <div
            className="arbitrage-paths"
            aria-label="Two potential arbitrage paths"
          >
            <div className="arbitrage-path">
              <span>When hBNKR trades above its buy cost</span>
              <p>
                Quote <ArrowRight /> Buy BNKR <ArrowRight /> Buy hBNKR{" "}
                <ArrowRight /> Sell hBNKR <ArrowRight /> Quote
              </p>
            </div>
            <div className="arbitrage-path">
              <span>When hBNKR is below redeem value</span>
              <p>
                Quote <ArrowRight /> Buy hBNKR <ArrowRight /> Return hBNKR{" "}
                <ArrowRight /> Sell BNKR <ArrowRight /> Quote
              </p>
            </div>
            <small>
              Potential only. Execution requires profit after fees, gas and
              slippage.
            </small>
          </div>
        </div>
      </section>

      <section className="product-section" aria-labelledby="product-title">
        <div className="section-lead compact">
          <span className="kicker">What GETHYPED verifies</span>
          <h2 id="product-title">
            One address.
            <br />
            One pool setup.
          </h2>
          <p>
            Enter the OG token contract once. GETHYPED prepares the Hyped Token
            and pool; your wallet confirms each transaction.
          </p>
        </div>
        <LaunchFlowVisual />
      </section>

      <section className="trust-section" aria-labelledby="trust-title">
        <div className="trust-copy">
          <div>
            <span className="kicker">Security by default</span>
            <h2 id="trust-title">
              Verified onchain.
              <br />
              Signed by you.
            </h2>
          </div>
          <div className="trust-summary">
            <p>
              GETHYPED prepares the call. Your wallet remains the execution
              boundary.
            </p>
            <Link className="text-arrow-link" href="/security">
              View security model <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <div
          className="trust-visual"
          aria-label="Onchain token data flows through Mint Club validation to a wallet signature"
        >
          <article>
            <div className="trust-node-top">
              <b>01</b>
              <em>Read only</em>
            </div>
            <div className="trust-icon">
              <Database />
            </div>
            <span>Onchain reads</span>
            <h3>Token metadata</h3>
          </article>
          <i className="trust-arrow" aria-hidden="true">
            <ArrowRight />
          </i>
          <article>
            <div className="trust-node-top">
              <b>02</b>
              <em>Mint Club SDK</em>
            </div>
            <div className="trust-icon pulse">
              <LockKeyhole />
            </div>
            <span>GETHYPED</span>
            <h3>Validate · encode</h3>
          </article>
          <i className="trust-arrow" aria-hidden="true">
            <ArrowRight />
          </i>
          <article>
            <div className="trust-node-top">
              <b>03</b>
              <em>Wallet boundary</em>
            </div>
            <div className="trust-icon">
              <WalletCards />
            </div>
            <span>Transaction</span>
            <h3>Review · sign</h3>
          </article>
        </div>
        <div className="trust-status">
          <i />
          <b>Non-custodial</b>
          <span>The relay can only run the limit you approve.</span>
        </div>
      </section>
    </main>
  );
}
