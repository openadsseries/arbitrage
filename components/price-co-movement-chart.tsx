"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import Image from "next/image";
import { tokenLogoUrl } from "@/components/token-logo";

type Point = { t: number; og: number; h: number };
type Timeframe = "hour" | "day";
type MarketKey = "hMT" | "hDRB" | "hBNKR" | "hDICKBUTT";
type MarketSnapshot = {
  ogSymbol: string;
  hypedSymbol: string;
  ogTokenAddress: string;
  tokenAddress: string;
  sourceUrl: string;
  data: Record<Timeframe, Point[]>;
};

const DICKBUTT_SNAPSHOT: Record<Timeframe, Point[]> = {
  hour: [
    { t: 1784412000, og: 100, h: 100 }, { t: 1784419200, og: 96.82, h: 98.13 },
    { t: 1784422800, og: 92.11, h: 95.83 }, { t: 1784426400, og: 91.52, h: 94.76 },
    { t: 1784476800, og: 97.11, h: 92.78 }, { t: 1784602800, og: 85.23, h: 91.98 },
    { t: 1784646000, og: 91.47, h: 92.24 }, { t: 1784804400, og: 83.07, h: 91.87 },
    { t: 1785078000, og: 88.69, h: 93.11 }, { t: 1785081600, og: 111.73, h: 99.88 },
    { t: 1785085200, og: 125.34, h: 111.1 }, { t: 1785096000, og: 109.12, h: 108.22 },
    { t: 1785150000, og: 113.32, h: 109.68 }, { t: 1785153600, og: 110.2, h: 110.1 },
    { t: 1785265200, og: 107.2, h: 88.4 }, { t: 1785412800, og: 112.33, h: 92.08 },
    { t: 1785416400, og: 111.29, h: 92.16 }, { t: 1785481200, og: 98.93, h: 89.14 },
    { t: 1785499200, og: 103.76, h: 86.72 }, { t: 1785549600, og: 107.32, h: 87.93 },
    { t: 1786057200, og: 103.97, h: 91.35 }, { t: 1786273200, og: 96.72, h: 88.37 },
    { t: 1786287600, og: 96.77, h: 86.32 }, { t: 1786525200, og: 91.26, h: 84.09 },
    { t: 1786719600, og: 82.68, h: 79.44 }, { t: 1786885200, og: 87.85, h: 80.33 },
    { t: 1786903200, og: 94.39, h: 86.06 }, { t: 1786921200, og: 101.36, h: 84.24 },
    { t: 1787086800, og: 94.02, h: 87.26 }, { t: 1787166000, og: 96.97, h: 93.53 },
    { t: 1787176800, og: 102.43, h: 97.9 }, { t: 1787191200, og: 103.5, h: 96.19 },
  ],
  day: [
    { t: 1782000000, og: 100, h: 100 }, { t: 1782950400, og: 86.37, h: 96.79 },
    { t: 1783036800, og: 91.6, h: 102.77 }, { t: 1783209600, og: 86.35, h: 99.86 },
    { t: 1783296000, og: 81.43, h: 96.01 }, { t: 1783382400, og: 75.78, h: 93.57 },
    { t: 1783468800, og: 70.59, h: 87.92 }, { t: 1783900800, og: 72.99, h: 83 },
    { t: 1783987200, og: 86.08, h: 88.2 }, { t: 1784073600, og: 79.74, h: 63.82 },
    { t: 1784160000, og: 75.63, h: 61.13 }, { t: 1784246400, og: 114.75, h: 78.21 },
    { t: 1784332800, og: 91.96, h: 69.1 }, { t: 1784419200, og: 86.76, h: 64.11 },
    { t: 1784592000, og: 83.11, h: 63.74 }, { t: 1784764800, og: 74.01, h: 63.48 },
    { t: 1785024000, og: 101.18, h: 74.79 }, { t: 1785110400, og: 103.48, h: 76.09 },
    { t: 1785196800, og: 98.8, h: 61.09 }, { t: 1785369600, og: 97.98, h: 63.69 },
    { t: 1785456000, og: 95.06, h: 59.93 }, { t: 1785542400, og: 94.87, h: 60.76 },
    { t: 1785974400, og: 96.25, h: 63.12 }, { t: 1786233600, og: 90.59, h: 59.65 },
    { t: 1786492800, og: 83.68, h: 58.11 }, { t: 1786665600, og: 78.57, h: 54.9 },
    { t: 1786838400, og: 93.84, h: 58.22 }, { t: 1787011200, og: 87.04, h: 60.3 },
    { t: 1787097600, og: 94.82, h: 67.65 }, { t: 1787184000, og: 95.82, h: 66.47 },
  ],
};

const MARKETS: Record<MarketKey, MarketSnapshot> = {
  hMT: {
    ogSymbol: "MT", hypedSymbol: "hMT", ogTokenAddress: "0xFf45161474C39cB00699070Dd49582e417b57a7E", tokenAddress: "0x467bA2Da859648dc7C258BcF6572adE499250E6a", sourceUrl: "https://mint.club/token/base/hMT",
    data: {
      hour: [
        { t: 1782572400, og: 100, h: 100 }, { t: 1782630000, og: 98.05, h: 98.05 },
        { t: 1782637200, og: 102.65, h: 101.99 }, { t: 1782997200, og: 109.94, h: 111.66 },
        { t: 1783033200, og: 109.55, h: 109.55 }, { t: 1783353600, og: 113.68, h: 115.98 },
        { t: 1784120400, og: 114.67, h: 119.16 }, { t: 1785132000, og: 113.68, h: 119.44 },
        { t: 1785394800, og: 105.41, h: 111.58 }, { t: 1787140800, og: 104.08, h: 112.17 },
        { t: 1787151600, og: 109.47, h: 118.85 }, { t: 1787173200, og: 115.26, h: 127.21 },
      ],
      day: [
        { t: 1771632000, og: 100, h: 100 }, { t: 1772582400, og: 100.43, h: 102.46 },
        { t: 1772755200, og: 99.81, h: 101.83 }, { t: 1773014400, og: 97.33, h: 97.33 },
        { t: 1773187200, og: 96.5, h: 99.88 }, { t: 1773273600, og: 90.74, h: 96.06 },
        { t: 1773619200, og: 95.22, h: 102.68 }, { t: 1773792000, og: 91.62, h: 100.64 },
        { t: 1774396800, og: 84.27, h: 89.83 }, { t: 1775088000, og: 81.32, h: 85.95 },
        { t: 1775606400, og: 87.06, h: 93.87 }, { t: 1775952000, og: 85.59, h: 90.47 },
        { t: 1776124800, og: 89.38, h: 97.44 }, { t: 1780358400, og: 72.65, h: 77.36 },
        { t: 1780531200, og: 68.95, h: 75.05 }, { t: 1780617600, og: 61.52, h: 66.07 },
        { t: 1782518400, og: 61.52, h: 65.02 }, { t: 1782604800, og: 63.15, h: 66.32 },
        { t: 1782950400, og: 67.4, h: 71.24 }, { t: 1783296000, og: 69.94, h: 75.41 },
        { t: 1784073600, og: 70.54, h: 77.48 }, { t: 1785110400, og: 69.94, h: 77.66 },
        { t: 1785369600, og: 64.85, h: 72.55 }, { t: 1787097600, og: 70.91, h: 82.72 },
      ],
    },
  },
  hDRB: {
    ogSymbol: "DRB", hypedSymbol: "hDRB", ogTokenAddress: "0x3ec2156D4c0A9CBdAB4a016633b7BcF6a8d68Ea2", tokenAddress: "0x23879479070377fAFE1dC101FBB5d263696b9d61", sourceUrl: "https://mint.club/token/base/hDRB",
    data: {
      hour: [
        { t: 1785776400, og: 100, h: 100 }, { t: 1785783600, og: 94.16, h: 98.21 },
        { t: 1785805200, og: 93.29, h: 96.34 }, { t: 1785808800, og: 96.51, h: 98.48 },
        { t: 1785873600, og: 96.11, h: 100.05 }, { t: 1785880800, og: 90.53, h: 96.33 },
        { t: 1785924000, og: 97.21, h: 99.19 }, { t: 1785938400, og: 98.15, h: 100.15 },
        { t: 1786028400, og: 99.13, h: 103.19 }, { t: 1786060800, og: 95.37, h: 99.97 },
        { t: 1786201200, og: 97.69, h: 101.52 }, { t: 1786251600, og: 99.1, h: 101.12 },
        { t: 1786381200, og: 95.77, h: 99.69 }, { t: 1786539600, og: 106.32, h: 104.68 },
        { t: 1786554000, og: 96.5, h: 100.46 }, { t: 1787054400, og: 93.08, h: 98.69 },
        { t: 1787076000, og: 91.16, h: 98.49 }, { t: 1787086800, og: 93.9, h: 98.47 },
        { t: 1787090400, og: 99.74, h: 101.77 }, { t: 1787151600, og: 109.78, h: 111.69 },
        { t: 1787158800, og: 113, h: 112.99 }, { t: 1787162400, og: 117.07, h: 115.13 },
        { t: 1787166000, og: 118.92, h: 116.94 }, { t: 1787169600, og: 128.66, h: 122 },
      ],
      day: [
        { t: 1784073600, og: 100, h: 100 }, { t: 1784160000, og: 92.29, h: 94.09 },
        { t: 1784246400, og: 97.16, h: 95.53 }, { t: 1784332800, og: 94.87, h: 94.95 },
        { t: 1784505600, og: 93.54, h: 95.59 }, { t: 1784592000, og: 88.69, h: 93.9 },
        { t: 1784678400, og: 90.05, h: 93.45 }, { t: 1784764800, og: 92.92, h: 94.59 },
        { t: 1784851200, og: 91.17, h: 94.67 }, { t: 1785024000, og: 87.23, h: 92.33 },
        { t: 1785110400, og: 95.84, h: 96.01 }, { t: 1785196800, og: 102.01, h: 100.08 },
        { t: 1785456000, og: 89.03, h: 93.01 }, { t: 1785715200, og: 82.72, h: 89.32 },
        { t: 1785801600, og: 79.53, h: 87.6 }, { t: 1785888000, og: 86.23, h: 91.08 },
        { t: 1785974400, og: 87.09, h: 93.84 }, { t: 1786060800, og: 83.79, h: 90.92 },
        { t: 1786147200, og: 85.83, h: 92.32 }, { t: 1786233600, og: 87.07, h: 91.96 },
        { t: 1786320000, og: 84.14, h: 90.66 }, { t: 1786492800, og: 84.78, h: 91.36 },
        { t: 1787011200, og: 87.63, h: 92.55 }, { t: 1787097600, og: 113.03, h: 110.95 },
      ],
    },
  },
  hBNKR: {
    ogSymbol: "BNKR", hypedSymbol: "hBNKR", ogTokenAddress: "0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b", tokenAddress: "0x94FF3398d08bb859E0D2CdC7A3F938AA7B109069", sourceUrl: "https://mint.club/token/base/hBNKR",
    data: {
      hour: [
        { t: 1786096800, og: 100, h: 100 }, { t: 1786269600, og: 95.65, h: 98.64 },
        { t: 1786586400, og: 88.95, h: 94.04 }, { t: 1786593600, og: 85.92, h: 92.65 },
        { t: 1786597200, og: 84.06, h: 92.1 }, { t: 1786600800, og: 82.51, h: 90.63 },
        { t: 1786604400, og: 75, h: 87.07 }, { t: 1786608000, og: 68.92, h: 82.5 },
        { t: 1786611600, og: 76.79, h: 87.39 }, { t: 1786615200, og: 81.34, h: 89.94 },
        { t: 1786618800, og: 78.43, h: 88.51 }, { t: 1786662000, og: 77.16, h: 88.04 },
        { t: 1786683600, og: 74.54, h: 87 }, { t: 1786690800, og: 71.77, h: 85.02 },
        { t: 1786892400, og: 69.17, h: 83.33 }, { t: 1786932000, og: 69.12, h: 83.26 },
        { t: 1786935600, og: 73.39, h: 85.53 }, { t: 1786968000, og: 73.02, h: 86.36 },
        { t: 1786971600, og: 69.72, h: 83.99 }, { t: 1787000400, og: 67.93, h: 83.36 },
        { t: 1787007600, og: 67.46, h: 82.78 }, { t: 1787173200, og: 78.81, h: 98.14 },
        { t: 1787176800, og: 76.9, h: 96.18 }, { t: 1787194800, og: 74.23, h: 94.52 },
      ],
      day: [
        { t: 1783468800, og: 100, h: 100 }, { t: 1783728000, og: 98.18, h: 101.96 },
        { t: 1784073600, og: 101.4, h: 101.4 }, { t: 1784160000, og: 98.28, h: 100.11 },
        { t: 1784246400, og: 89.13, h: 92.48 }, { t: 1784332800, og: 94.76, h: 96.38 },
        { t: 1784678400, og: 94.35, h: 97.9 }, { t: 1784764800, og: 111.26, h: 105.1 },
        { t: 1784851200, og: 95.28, h: 97.06 }, { t: 1784937600, og: 85.53, h: 91.98 },
        { t: 1785024000, og: 86.27, h: 92.74 }, { t: 1785196800, og: 92.75, h: 98.03 },
        { t: 1785369600, og: 91.8, h: 97.33 }, { t: 1785715200, og: 83.27, h: 91.32 },
        { t: 1785801600, og: 81.49, h: 89.52 }, { t: 1785888000, og: 83.71, h: 90.02 },
        { t: 1786060800, og: 91.58, h: 96.64 }, { t: 1786233600, og: 87.59, h: 95.33 },
        { t: 1786579200, og: 70.67, h: 85.08 }, { t: 1786665600, og: 65.73, h: 82.17 },
        { t: 1786838400, og: 63.35, h: 80.53 }, { t: 1786924800, og: 61.78, h: 79.99 },
        { t: 1787097600, og: 70.43, h: 92.95 }, { t: 1787184000, og: 67.98, h: 91.34 },
      ],
    },
  },
  hDICKBUTT: {
    ogSymbol: "DICKBUTT", hypedSymbol: "hDICKBUTT", ogTokenAddress: "0x2D57C47BC5D2432FEEEdf2c9150162A9862D3cCf", tokenAddress: "0xe0d1bC936c8724DBdCb87dB11441fb3bb6b364ce", sourceUrl: "https://mint.club/token/base/hDICKBUTT",
    data: DICKBUTT_SNAPSHOT,
  },
};

const MARKET_ORDER: MarketKey[] = ["hMT", "hDRB", "hBNKR", "hDICKBUTT"];

const CHART = { left: 38, right: 522, top: 50, bottom: 244 };

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(timestamp * 1000));
}

function change(value: number) {
  const delta = value - 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

export function PriceCoMovementChart() {
  const [marketKey, setMarketKey] = useState<MarketKey>("hMT");
  const [timeframe, setTimeframe] = useState<Timeframe>("day");
  const market = MARKETS[marketKey];
  const points = market.data[timeframe];
  const chart = useMemo(() => {
    const allValues = points.flatMap((point) => [point.og, point.h]);
    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const padding = Math.max(4, (rawMax - rawMin) * 0.12);
    const min = rawMin - padding;
    const max = rawMax + padding;
    const firstTime = points[0].t;
    const lastTime = points.at(-1)?.t ?? firstTime;
    const map = (point: Point, key: "og" | "h") => ({
      x: CHART.left + ((point.t - firstTime) / (lastTime - firstTime || 1)) * (CHART.right - CHART.left),
      y: CHART.bottom - ((point[key] - min) / (max - min || 1)) * (CHART.bottom - CHART.top),
    });
    const series = (key: "og" | "h") => points
      .map((point) => map(point, key))
      .map(({ x, y }) => `${x},${y}`)
      .join(" ");
    return {
      og: series("og"),
      h: series("h"),
      min,
      max,
    };
  }, [points]);
  const latest = points.at(-1) ?? points[0];

  return (
    <section className="co-movement" aria-labelledby="co-movement-title">
      <div className="co-movement-head">
        <div>
          <span>Historical market snapshot</span>
          <h2 id="co-movement-title">The OG and its Hyped Token.</h2>
        </div>
        <div className="chart-controls">
          <div className="timeframe-tabs" role="tablist" aria-label="Chart candle interval">
            <button className={timeframe === "hour" ? "selected" : ""} onClick={() => setTimeframe("hour")} role="tab" type="button">1H</button>
            <button className={timeframe === "day" ? "selected" : ""} onClick={() => setTimeframe("day")} role="tab" type="button">1D</button>
          </div>
          <details className="chart-help">
            <summary aria-label="How to read this chart"><Info size={13} /><span>Details</span></summary>
            <div>
              <strong>Chart details</strong>
              <p>Both USD price series are normalized to the same starting point, so their direction can be compared despite different token prices.</p>
              <dl>
                <div><dt>Normalization</dt><dd>Start = 100</dd></div>
                <div><dt>Interval</dt><dd>{timeframe === "hour" ? "1-hour traded candles" : "1-day candles"}</dd></div>
                <div><dt>Captured</dt><dd>Aug 20, 2026</dd></div>
                <div><dt>Source</dt><dd>GeckoTerminal Base OHLCV</dd></div>
              </dl>
              <p>Each line connects the captured historical close observations in chronological order. Missing intervals are not filled with generated data.</p>
              <p>Historical snapshot · User-requested examples · Not guaranteed performance.</p>
              <a href={market.sourceUrl} target="_blank" rel="noreferrer">View token on Mint Club ↗</a>
            </div>
          </details>
        </div>
      </div>

      <div className="example-market-tabs" role="tablist" aria-label="Select a shared Hyped Token example">
        {MARKET_ORDER.map((key) => (
          <button className={marketKey === key ? "selected" : ""} key={key} onClick={() => setMarketKey(key)} role="tab" type="button">
            <Image src={tokenLogoUrl(MARKETS[key].tokenAddress)} alt="" width={18} height={18} unoptimized />
            <span>{key}</span>
          </button>
        ))}
      </div>

      <div className="co-movement-values">
        <div className="series-value og">
          <span className="series-identity"><Image src={tokenLogoUrl(market.ogTokenAddress)} alt={`${market.ogSymbol} token logo`} width={30} height={30} unoptimized /><strong>{market.ogSymbol}</strong></span>
          <div className="series-metric"><strong>{latest.og.toFixed(1)}</strong><small>Index</small><b className={latest.og >= 100 ? "up" : "down"}>{change(latest.og)}</b></div>
        </div>
        <div className="series-value hyped">
          <span className="series-identity"><Image src={tokenLogoUrl(market.tokenAddress)} alt={`${market.hypedSymbol} token logo`} width={30} height={30} unoptimized /><strong>{market.hypedSymbol}</strong></span>
          <div className="series-metric"><strong>{latest.h.toFixed(1)}</strong><small>Index</small><b className={latest.h >= 100 ? "up" : "down"}>{change(latest.h)}</b></div>
        </div>
      </div>

      <div className="co-movement-chart">
        <svg key={`${marketKey}-${timeframe}`} viewBox="0 0 560 285" role="img" aria-label={`Historical normalized USD prices for ${market.ogSymbol} and ${market.hypedSymbol} overlaid on the same chart`}>
          <g className="market-grid" aria-hidden="true">
            {[50, 115, 180, 244].map((y) => <line key={y} x1={CHART.left} y1={y} x2={CHART.right} y2={y} />)}
            {[38, 280, 522].map((x) => <line key={x} x1={x} y1={CHART.top} x2={x} y2={CHART.bottom} />)}
          </g>
          <line className="index-line" x1={CHART.left} y1={CHART.bottom - ((100 - chart.min) / (chart.max - chart.min)) * (CHART.bottom - CHART.top)} x2={CHART.right} y2={CHART.bottom - ((100 - chart.min) / (chart.max - chart.min)) * (CHART.bottom - CHART.top)} />
          <polyline className="market-line og" pathLength="1" points={chart.og} />
          <polyline className="market-line hyped" pathLength="1" points={chart.h} />
          <g className="market-axis" aria-hidden="true">
            <text x={CHART.left} y="274">{formatDate(points[0].t)}</text>
            <text x={CHART.right} y="274" textAnchor="end">{formatDate(latest.t)}</text>
          </g>
        </svg>
      </div>

      <div className="chart-foot">
        <span>Candle interval · {timeframe === "hour" ? "1 hour" : "1 day"}</span>
        <span>{formatDate(points[0].t)} — {formatDate(latest.t)}</span>
      </div>
    </section>
  );
}
