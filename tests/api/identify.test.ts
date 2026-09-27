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

  it("rejects malformed upload context before initializing providers", async () => {
    process.env.RATE_LIMIT_HMAC_SECRET = "test-secret";
    const fields = new Map<string, unknown>([
      ["image", { size: 1, arrayBuffer: async () => new ArrayBuffer(1) }],
      ["context", "{not-json"]
    ]);
    const response = await POST({ formData: async () => ({ get: (key: string) => fields.get(key) ?? null }) } as unknown as Request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ state: "ERROR", error: "INVALID_IMAGE" });
  });

  it("does not initialize providers when the rate-limit secret is missing", async () => {
    delete process.env.RATE_LIMIT_HMAC_SECRET;
    const response = await POST({
      formData: async () => ({
        get: (key: string) => key === "image" ? ({
          size: 1,
          arrayBuffer: async () => new ArrayBuffer(1)
        }) : null
      })
    } as unknown as Request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ state: "ERROR", error: "PROCESSING_FAILED" });
  });
});
