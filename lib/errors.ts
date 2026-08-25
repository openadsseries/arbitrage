export function compactActionError(reason: unknown, fallback: string) {
  const candidates: unknown[] = [];
  if (reason instanceof Error) {
    candidates.push(reason.message);
    const cause = reason.cause as { message?: unknown; shortMessage?: unknown; details?: unknown } | undefined;
    if (cause) candidates.push(cause.shortMessage, cause.message, cause.details);
  } else if (typeof reason === "object" && reason) {
    const value = reason as { message?: unknown; shortMessage?: unknown; details?: unknown };
    candidates.push(value.shortMessage, value.message, value.details);
  } else {
    candidates.push(reason);
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const message = candidate.trim();
    if (/user denied|user rejected|request signature/i.test(message)) return "Wallet approval was cancelled.";
    if (/over rate limit|rate.?limit|too many requests|429|defined limit|base rpc is busy/i.test(message)) {
      return "Base RPC is busy. Wait a moment and try again.";
    }
    if (/not executable now/i.test(message)) return "Not executable now.";
    if (/rpc request failed|http request failed|failed to fetch|network request|raw call arguments|contract call|request body|url:/i.test(message)) {
      return "The Base read was interrupted. Try again.";
    }
    if (message.length <= 180) return message;
  }

  return fallback;
}
