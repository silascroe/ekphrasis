import { describe, expect, it, vi } from "vitest";
import { prepareUploadFile } from "../../lib/image/client";
import { extractUploadContext } from "../../lib/image/upload-context";

describe("prepareUploadFile", () => {
  it("shrinks a large phone photo before upload", async () => {
    const file = new File(
      [new Uint8Array(11 * 1024 * 1024)],
      "painting.heic",
      { type: "image/heic" }
    );
    const context = await extractUploadContext(file);
    const encode = vi.fn(async (_source: unknown, width: number, height: number) => {
      expect(width).toBe(1600);
      expect(height).toBe(1200);
      return new Blob([new Uint8Array(700_000)], { type: "image/jpeg" });
    });

    const prepared = await prepareUploadFile(file, {
      decode: async () => ({ source: {} as CanvasImageSource, width: 4000, height: 3000, dispose: () => {} }),
      encode
    });

    expect(encode).toHaveBeenCalledOnce();
    expect(prepared.name).toBe("painting.jpg");
    expect(prepared.type).toBe("image/jpeg");
    expect(prepared.size).toBeLessThan(file.size);
    expect(context.originalFilename).toBe("painting.heic");
    expect(context.originalMimeType).toBe("image/heic");
  });

  it("leaves an already-small image untouched", async () => {
    const file = new File([new Uint8Array(1000)], "painting.jpg", { type: "image/jpeg" });
    const decode = vi.fn();

    const prepared = await prepareUploadFile(file, {
      decode,
      encode: vi.fn()
    });

    expect(prepared).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });
});
