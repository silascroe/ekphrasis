import { afterEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import { CodexVisionAdapter } from "../../lib/vision/codex";
import type { UploadContext } from "../../lib/image/upload-context";

const image = Buffer.from("normalized image bytes");
const secret = "unit-test-bridge-secret";
const context: UploadContext = {
  originalFilename: "The_Work_by_Painter.jpg",
  originalMimeType: "image/heic",
  originalSize: 2_400_000,
  embedded: { title: "The Work", artist: "Painter", documentName: "Catalog Entry 73" }
};

function successResponse(): Response {
  return new Response(JSON.stringify({
    artist: "Painter",
    title: "The Work",
    year: "1901",
    medium: null,
    candidates: [{ text: "distinctive catalog phrase" }],
    confidence: "high",
    source_urls: ["https://museum.example/object/42"],
    evidence: ["The signature reads Painter."]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fetchMockWith(response: Response): MockedFunction<typeof fetch> {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

afterEach(() => vi.restoreAllMocks());

describe("CodexVisionAdapter", () => {
  it("sends authenticated JSON with normalized bytes and original upload context", async () => {
    const fetcher = fetchMockWith(successResponse());
    const adapter = new CodexVisionAdapter("https://vision.example.test", secret, fetcher, 260_000);

    const result = await adapter.detect({ image, context });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://vision.example.test/v1/identify");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
    const bodyText = String(init?.body);
    const body = JSON.parse(bodyText) as Record<string, any>;
    expect(body).toMatchObject({
      version: 1,
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      image: { mime_type: "image/jpeg", base64: image.toString("base64") },
      context: {
        original_filename: "The_Work_by_Painter.jpg",
        original_mime_type: "image/heic",
        original_size: 2_400_000,
        embedded: { title: "The Work", artist: "Painter", document_name: "Catalog Entry 73" }
      }
    });
    expect(bodyText).not.toContain(secret);
    expect(result).toEqual({
      extracted: { artist: "Painter", title: "The Work", year: "1901", medium: null },
      webDetection: {
        webEntities: [
          { description: "distinctive catalog phrase" },
          { description: "Painter" },
          { description: "The Work" },
          { description: "1901" }
        ],
        bestGuessLabels: []
      }
    });
  });

  it.each([401, 403])("maps HTTP %i to an authentication failure", async status => {
    const adapter = new CodexVisionAdapter("https://vision.example.test", secret, fetchMockWith(new Response("unauthorized", { status })));
    await expect(adapter.detect({ image })).rejects.toMatchObject({ provider: "vision", failure: "AUTH" });
  });

  it("maps HTTP 429 to a retryable rate-limit failure", async () => {
    const adapter = new CodexVisionAdapter("https://vision.example.test", secret, fetchMockWith(new Response("busy", { status: 429 })));
    await expect(adapter.detect({ image })).rejects.toMatchObject({ provider: "vision", failure: "RATE_LIMITED" });
  });

  it("maps a Codex timeout response and an aborted fetch to TIMEOUT", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("timeout", { status: 504 }))
      .mockRejectedValueOnce(new DOMException("deadline", "TimeoutError"));
    const adapter = new CodexVisionAdapter("https://vision.example.test", secret, fetcher);

    await expect(adapter.detect({ image })).rejects.toMatchObject({ failure: "TIMEOUT" });
    await expect(adapter.detect({ image })).rejects.toMatchObject({ failure: "TIMEOUT" });
  });

  it("rejects invalid JSON or response schemas as provider failures", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ artist: "Painter", candidates: "not-an-array" }), { status: 200 }));
    const adapter = new CodexVisionAdapter("https://vision.example.test", secret, fetcher);

    await expect(adapter.detect({ image })).rejects.toMatchObject({ provider: "vision", failure: "PROVIDER_ERROR" });
    await expect(adapter.detect({ image })).rejects.toMatchObject({ provider: "vision", failure: "PROVIDER_ERROR" });
  });

  it("maps other server errors to provider failures without logging image data or credentials", async () => {
    const logger = vi.spyOn(console, "info").mockImplementation(() => {});
    const adapter = new CodexVisionAdapter("https://vision.example.test", secret, fetchMockWith(new Response("temporary secret-bearing error", { status: 500 })));

    await expect(adapter.detect({ image })).rejects.toMatchObject({ provider: "vision", failure: "PROVIDER_ERROR" });

    const logs = JSON.stringify(logger.mock.calls);
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain(image.toString());
  });
});
