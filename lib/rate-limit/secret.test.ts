import { afterEach, describe, expect, it } from "vitest";
import { getRateLimitSecret } from "./secret";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("getRateLimitSecret", () => {
  it("does not reuse provider credentials as the rate-limit secret", () => {
    delete process.env.RATE_LIMIT_HMAC_SECRET;
    process.env.HF_TOKEN = "hf-test-secret";

    expect(getRateLimitSecret()).toBeUndefined();
  });

  it("returns the dedicated HMAC secret when configured", () => {
    process.env.RATE_LIMIT_HMAC_SECRET = "rate-limit-secret";
    process.env.HF_TOKEN = "hf-test-secret";

    expect(getRateLimitSecret()).toBe("rate-limit-secret");
  });
});
