import { describe, expect, it } from "vitest";
import { validateSameOriginJson } from "./request-origin";

const baseRequest = {
  requestUrl: "https://gethyped.test/api/rpc/base",
  origin: "https://gethyped.test",
  fetchSite: "same-origin",
  contentType: "application/json",
  forwardedHost: null,
  forwardedProtocol: null,
};

describe("same-origin JSON validation", () => {
  it("accepts JSON from the current site", () => {
    expect(validateSameOriginJson(baseRequest)).toBeNull();
  });

  it("blocks cross-site and originless calls", () => {
    expect(
      validateSameOriginJson({
        ...baseRequest,
        origin: "https://other.test",
        fetchSite: "cross-site",
      }),
    ).toBe(403);
    expect(validateSameOriginJson({ ...baseRequest, origin: null })).toBe(403);
  });

  it("rejects non-JSON requests", () => {
    expect(
      validateSameOriginJson({ ...baseRequest, contentType: "text/plain" }),
    ).toBe(415);
  });
});
