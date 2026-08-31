import { describe, expect, it } from "vitest";
import {
  isOpportunityQuoteFresh,
  MAX_OPPORTUNITY_STALE_SECONDS,
} from "../arbitrage-freshness";

describe("arbitrage opportunity cache freshness", () => {
  const now = 1_788_140_613;

  it("accepts a quote at the hard freshness boundary", () => {
    expect(
      isOpportunityQuoteFresh(now - MAX_OPPORTUNITY_STALE_SECONDS, now),
    ).toBe(true);
  });

  it("rejects a quote older than the hard freshness boundary", () => {
    expect(
      isOpportunityQuoteFresh(now - MAX_OPPORTUNITY_STALE_SECONDS - 1, now),
    ).toBe(false);
  });

  it("rejects a quote timestamp from the future", () => {
    expect(isOpportunityQuoteFresh(now + 1, now)).toBe(false);
  });
});
