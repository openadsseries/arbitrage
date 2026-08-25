export default function MarketsLoading() {
  return (
    <div className="inner-page page-shell">
      <div className="page-title">
        <span className="kicker">Onchain Hyped Token pools</span>
        <h1>Markets</h1>
        <p>Live Hyped Token pools across every supported network.</p>
      </div>
      <div className="market-table onchain-market-table loading" aria-label="Loading markets">
        <div className="table-head"><span>Market</span><span>Price</span><span>Market cap</span><span>Backing</span><span>Arbitrage</span><span>Action</span></div>
        {[0, 1, 2, 3].map((item) => <div className="market-row skeleton-row" key={item}><span /><span /><span /><span /><span /><span /></div>)}
      </div>
    </div>
  );
}
