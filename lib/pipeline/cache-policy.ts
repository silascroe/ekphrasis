import type { IdentificationResult } from "../types";

export type CacheClass = "normal" | "degraded" | "uncacheable";
export type CachePolicyInput =
  | { state: "ERROR"; error?: string }
  | { state: "MATCH" | "SUGGESTION" | "NO_MATCH"; degraded: boolean };

export function cacheClassFor(result: CachePolicyInput): CacheClass {
  if (result.state === "ERROR") return "uncacheable";
  return result.degraded || result.state === "SUGGESTION" ? "degraded" : "normal";
}

export function ttlFor(cacheClass: Exclude<CacheClass, "uncacheable">): number {
  return cacheClass === "normal" ? 7 * 24 * 60 * 60 : 15 * 60;
}

export function cacheableResult(result: IdentificationResult): CachePolicyInput {
  if (result.state === "ERROR") return { state: "ERROR" };
  return { state: result.state, degraded: result.state === "SUGGESTION" || result.degraded };
}
