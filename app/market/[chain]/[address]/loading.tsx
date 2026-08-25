import Link from "next/link";
import { ArrowLeft, LoaderCircle } from "lucide-react";

export default function MarketDetailLoading() {
  return (
    <div className="inner-page page-shell market-detail-page">
      <Link href="/markets" className="back-link"><ArrowLeft /> Markets</Link>
      <div className="market-detail-loading" aria-live="polite">
        <LoaderCircle className="spin" />
        <div>
          <span className="kicker">Loading market</span>
          <h1>Preparing the arbitrage view.</h1>
        </div>
      </div>
    </div>
  );
}
