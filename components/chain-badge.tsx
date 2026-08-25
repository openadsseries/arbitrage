import type { ChainKey } from "@/lib/chains";

export function ChainBadge({ chain, className = "" }: { chain: ChainKey; className?: string }) {
  const label = chain === "base" ? "Base" : "Robinhood Chain";
  return (
    <span className={`chain-badge ${chain} ${className}`.trim()} title={label} aria-label={label}>
      {chain === "base" ? (
        // Official Base Square vector from brand.base.org/base-brand.zip.
        <svg viewBox="0 0 1280 1280" role="img" aria-hidden="true"><path d="M0 101.12C0 66.48 0 49.17 6.53 35.84A66.3 66.3 0 0 1 35.85 6.52C49.17 0 66.48 0 101.12 0h1077.76c34.63 0 51.96 0 65.28 6.53a66.3 66.3 0 0 1 29.32 29.32c6.52 13.32 6.52 30.64 6.52 65.28v1077.76c0 34.63 0 51.96-6.52 65.28a66.3 66.3 0 0 1-29.32 29.32c-13.32 6.52-30.65 6.52-65.28 6.52H101.12c-34.64 0-51.95 0-65.28-6.52a66.3 66.3 0 0 1-29.32-29.32C0 1230.85 0 1213.52 0 1178.89V101.12Z" /></svg>
      ) : (
        // Robinhood's registered feather mark in the current Robin Neon palette.
        <svg viewBox="0 0 24 24" role="img" aria-hidden="true"><path d="M2.84 24h.53c.096 0 .192-.048.224-.128C7.591 13.696 11.94 8.656 14.67 5.638c.112-.128.064-.225-.096-.225h-4.88a.55.55 0 0 0-.45.225L5.746 9.972c-.514.642-.642 1.236-.642 2.086v4.43c-1.14 3.194-1.862 5.361-2.392 7.32-.032.125.016.192.129.192M20.447.646c-.754-.802-4.157-.834-5.73-.224a3 3 0 0 0-.786.465 41 41 0 0 0-3.323 3.178c-.112.113-.064.225.097.225h5.409c.497 0 .786.289.786.786v6.1c0 .16.128.208.225.064l3.258-4.254c.53-.69.69-.898.835-1.861.192-1.413.08-3.58-.77-4.479m-6.982 16.18 2.231-3.676a.7.7 0 0 0 .064-.29V6.73c0-.16-.112-.225-.224-.097-3.355 3.74-5.971 7.672-8.395 12.407-.06.12.016.225.16.177l5.009-1.54c.565-.174.882-.402 1.155-.852" /></svg>
      )}
    </span>
  );
}
