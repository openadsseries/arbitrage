import { AlertCircle, Check, Clock3 } from "lucide-react";
import type { ArbitrageRouteCheck } from "@/lib/arbitrage-route-status";

export function ArbitrageRouteChecks({
  checks,
  showDetails = false,
}: {
  checks: ArbitrageRouteCheck[];
  showDetails?: boolean;
}) {
  const readyCount = checks.filter((check) => check.tone === "ready").length;
  const holdingCheck = checks.find((check) => check.tone !== "ready");
  const sequenceState = holdingCheck
    ? `Holding at ${holdingCheck.label.toLowerCase()}`
    : "Clear to run";
  const compactLabels: Record<ArbitrageRouteCheck["key"], string> = {
    reserve: "Mint",
    pool: "Pool",
    costs: "Costs",
    automation: "Auto",
  };

  return (
    <div
      className={`arbitrage-route-check-group ${showDetails ? "is-detailed" : "is-compact"}`}
    >
      <div className="arbitrage-route-check-head">
        <span>Preflight</span>
        <div>
          {showDetails && <strong>{sequenceState}</strong>}
          <small>{readyCount}/{checks.length} ready</small>
        </div>
      </div>
      <ol
        className={`arbitrage-route-checks${showDetails ? " has-details" : ""}`}
        aria-label="Arbitrage route checks"
      >
        {checks.map((check, index) => (
          <li
            key={check.key}
            data-tone={check.tone}
            title={`${check.label}: ${check.value}`}
          >
            <span className="route-check-icon" aria-hidden="true">
              {check.tone === "ready" ? (
                <Check />
              ) : check.tone === "blocked" ? (
                <AlertCircle />
              ) : (
                <Clock3 />
              )}
            </span>
            <span className="route-check-label">
              <small>0{index + 1}</small>
              {showDetails ? check.label : compactLabels[check.key]}
            </span>
            <strong className="route-check-value">{check.value}</strong>
            {showDetails && (
              <small className="route-check-detail">{check.detail}</small>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
