import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../../app/api/identify/route";

const originalSecret = process.env.RATE_LIMIT_HMAC_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.RATE_LIMIT_HMAC_SECRET;
  else process.env.RATE_LIMIT_HMAC_SECRET = originalSecret;
});

describe("identify API boundary", () => {
  it("rejects requests without an image", async () => {
    const response = await POST({ formData: async () => new FormData() } as unknown as Request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ state: "ERROR", error: "INVALID_IMAGE" });
  });

  it("does not initialize providers when the rate-limit secret is missing", async () => {
    delete process.env.RATE_LIMIT_HMAC_SECRET;
    const response = await POST({
      formData: async () => ({
        get: () => ({
          size: 1,
          arrayBuffer: async () => new ArrayBuffer(1)
        })
      })
    } as unknown as Request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ state: "ERROR", error: "PROCESSING_FAILED" });
  });
});
