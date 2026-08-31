const INFRASTRUCTURE_ERROR =
  /over rate limit|rate.?limit|too many requests|\b429\b|\b401\b|\b403\b|unauthorized|forbidden|archive requests require|rpc request failed|json-rpc|internal rpc error|http request failed|failed to fetch|network request|network error|fetch failed|timed?\s*out|timeout|socket|connection (?:closed|reset|refused)|econn(?:reset|refused)|service unavailable|gateway timeout|base rpc is busy/i;
const CONTRACT_REVERT_ERROR =
  /execution reverted|contract function .* reverted|contract call reverted|reverted with|revert reason/i;

export class ArbitrageRouteUnavailableError extends Error {
  constructor(message = "No route.", options?: ErrorOptions) {
    super(message, options);
    this.name = "ArbitrageRouteUnavailableError";
  }
}

function errorMessages(reason: unknown) {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = reason;

  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "string") {
      messages.push(current);
      break;
    }
    if (typeof current !== "object") break;
    const value = current as {
      message?: unknown;
      shortMessage?: unknown;
      details?: unknown;
      cause?: unknown;
    };
    for (const candidate of [value.shortMessage, value.message, value.details]) {
      if (typeof candidate === "string") messages.push(candidate);
    }
    current = value.cause;
  }

  return messages;
}

export function isArbitrageInfrastructureError(reason: unknown) {
  return errorMessages(reason).some((message) =>
    INFRASTRUCTURE_ERROR.test(message),
  );
}

export function isArbitrageRouteUnavailableError(reason: unknown) {
  return reason instanceof ArbitrageRouteUnavailableError;
}

export function isArbitrageContractRevertError(reason: unknown) {
  return errorMessages(reason).some((message) =>
    CONTRACT_REVERT_ERROR.test(message),
  );
}
