import type { IdentificationResult } from "../types";
import { cacheClassFor, cacheableResult, ttlFor } from "../pipeline/cache-policy";
import type { ResultCache } from "./cache";

type MemoryEntry = {
  value: IdentificationResult;
  expiresAt: number;
};

export class MemoryResultCache implements ResultCache {
  private readonly values = new Map<string, MemoryEntry>();

  constructor(private readonly now = () => Date.now()) {}

  async get(hash: string): Promise<IdentificationResult | null> {
    const entry = this.values.get(hash);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.values.delete(hash);
      return null;
    }
    return entry.value;
  }

  async set(hash: string, result: IdentificationResult): Promise<void> {
    const cacheClass = cacheClassFor(cacheableResult(result));
    if (cacheClass === "uncacheable") return;
    this.values.set(hash, {
      value: result,
      expiresAt: this.now() + ttlFor(cacheClass) * 1000
    });
  }
}

export class ResilientResultCache implements ResultCache {
  constructor(
    private readonly primary: ResultCache,
    private readonly fallback: ResultCache
  ) {}

  async get(hash: string): Promise<IdentificationResult | null> {
    try {
      return await this.primary.get(hash);
    } catch {
      return await this.fallback.get(hash);
    }
  }

  async set(hash: string, result: IdentificationResult): Promise<void> {
    try {
      await this.primary.set(hash, result);
    } catch {
      await this.fallback.set(hash, result);
    }
  }
}
