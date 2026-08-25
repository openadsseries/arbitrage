import { describe, expect, it } from "vitest";
import { isAddress } from "viem";
import { KNOWN_MARKETS } from "./known-markets";

describe("known h-token market definitions", () => {
  it("contains unique, valid token and reserve addresses", () => {
    const keys = KNOWN_MARKETS.map((market) => `${market.chain}:${market.token.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const market of KNOWN_MARKETS) {
      expect(isAddress(market.token)).toBe(true);
      expect(isAddress(market.expectedReserve)).toBe(true);
      expect(market.token.toLowerCase()).not.toBe(market.expectedReserve.toLowerCase());
      expect(market.mintClubUrl.startsWith("https://mint.club/token/")).toBe(true);
    }
  });
});
