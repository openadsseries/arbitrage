export const MAX_OPPORTUNITY_STALE_SECONDS = 30;

export function isOpportunityQuoteFresh(
  quotedAt: number,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const ageSeconds = nowSeconds - quotedAt;
  return ageSeconds >= 0 && ageSeconds <= MAX_OPPORTUNITY_STALE_SECONDS;
}
