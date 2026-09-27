import { describe, expect, it } from "vitest";
import { MemoryResultCache, ResilientResultCache } from "./runtime";
import type { IdentificationResult } from "../types";

const result = { state: "NO_MATCH", reason: "insufficient_evidence", degraded: false, unavailable_sources: [] } as IdentificationResult;

describe("MemoryResultCache", () => {
  it("expires degraded results according to the cache policy", async () => {
    let now = 1_000;
    const cache = new MemoryResultCache(() => now);
    const degraded: IdentificationResult = {
      state: "NO_MATCH",
      reason: "insufficient_evidence",
      degraded: true,
      unavailable_sources: ["met"]
    };

    await cache.set("a", degraded);
    now += 15 * 60 * 1000 + 1;
    expect(await cache.get("a")).toBeNull();
  });
});

describe("ResilientResultCache", () => {
  it("falls back when the primary cache fails", async () => {
    const fallback = new Map<string, IdentificationResult>();
    const cache = new ResilientResultCache(
      {
        async get() { throw new Error("redis unavailable"); },
        async set() { throw new Error("redis unavailable"); }
      },
      {
        async get(key) { return fallback.get(key) ?? null; },
        async set(key, value) { fallback.set(key, value); }
      }
    );

    expect(await cache.get("a")).toBeNull();
    await cache.set("a", result);
    expect(await cache.get("a")).toEqual(result);
  });
});
