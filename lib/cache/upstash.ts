import { Redis } from "@upstash/redis";
import type { IdentificationResult } from "../types";
import { cacheClassFor, cacheableResult, ttlFor } from "../pipeline/cache-policy";
import type { ResultCache } from "./cache";

export class UpstashResultCache implements ResultCache {
  private readonly redis: Redis;

  constructor(redis = Redis.fromEnv()) {
    this.redis = redis;
  }

  async get(hash: string): Promise<IdentificationResult | null> {
    return (await this.redis.get<IdentificationResult>(`ekphrasis:result:${hash}`)) ?? null;
  }

  async set(hash: string, result: IdentificationResult): Promise<void> {
    const cacheClass = cacheClassFor(cacheableResult(result));
    if (cacheClass === "uncacheable") return;
    await this.redis.set(`ekphrasis:result:${hash}`, result, { ex: ttlFor(cacheClass) });
  }
}
