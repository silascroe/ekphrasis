import { describe, expect, it } from "vitest";
import { cacheClassFor, ttlFor } from "../../../lib/pipeline/cache-policy";

describe("result cache policy", () => {
  it("caches normal match and no-match for 7 days", () => {
    expect(cacheClassFor({ state: "MATCH", degraded: false })).toBe("normal");
    expect(cacheClassFor({ state: "NO_MATCH", degraded: false })).toBe("normal");
    expect(ttlFor("normal")).toBe(7 * 24 * 60 * 60);
  });

  it("uses a 15 minute TTL for degraded results", () => {
    expect(cacheClassFor({ state: "MATCH", degraded: true })).toBe("degraded");
    expect(ttlFor("degraded")).toBe(15 * 60);
  });

  it("keeps unverified suggestions on the short degraded cache lifetime", () => {
    expect(cacheClassFor({ state: "SUGGESTION", degraded: false })).toBe("degraded");
    expect(ttlFor("degraded")).toBe(15 * 60);
  });

  it("never caches API unavailable", () => {
    expect(cacheClassFor({ state: "ERROR", error: "API_UNAVAILABLE" })).toBe("uncacheable");
  });
});
