import { describe, expect, it, vi } from "vitest";
import type { UploadContext } from "../../../lib/image/upload-context";
import { identifyImage } from "../../../lib/pipeline/identify";
import type { IdentificationResult } from "../../../lib/types";

const detection = {
  extracted: { artist: "Artist", title: "A Work", year: "1901", medium: null },
  webDetection: { webEntities: [{ description: "A Work" }, { description: "Artist" }] }
};

function dependencies(onCacheKey?: (key: string) => void) {
  let received: unknown;
  const vision = {
    detect: vi.fn(async (input: unknown) => {
      received = input;
      return detection;
    })
  };
  return {
    vision,
    getReceivedInput: () => received,
    deps: {
      cache: {
        get: async (key: string): Promise<IdentificationResult | null> => {
          onCacheKey?.(key);
          return null;
        },
        set: async () => {}
      },
      limiter: { check: async () => ({ allowed: true }) },
      validate: async () => ({ bytes: Buffer.from([1]), format: "jpeg" as const, width: 1, height: 1 }),
      normalize: async () => ({ bytes: Buffer.from([9, 8]), mimeType: "image/jpeg" as const, width: 1, height: 1 }),
      vision,
      museums: [{ id: "met", name: "The Met", search: async () => [] }]
    }
  };
}

const uploadContext: UploadContext = {
  originalFilename: "painting.heic",
  originalMimeType: "image/heic",
  originalSize: 11_000_000,
  embedded: { title: "A Work", artist: "Artist" }
};

const file = () => new File([new Uint8Array([1])], "painting.jpg", { type: "image/jpeg" });

describe("upload context in the identification pipeline", () => {
  it("passes normalized bytes and original upload clues to the vision provider", async () => {
    const setup = dependencies();
    await identifyImage({ file: file(), address: "test", context: uploadContext }, setup.deps);

    expect(setup.getReceivedInput()).toEqual({ image: Buffer.from([9, 8]), context: uploadContext });
  });

  it("includes identity clues in the cache key but excludes diagnostic original size", async () => {
    const keys: string[] = [];
    const first = dependencies(key => keys.push(key));
    const changedClue = dependencies(key => keys.push(key));
    const changedSize = dependencies(key => keys.push(key));

    await identifyImage({ file: file(), address: "one", context: uploadContext }, first.deps);
    await identifyImage({ file: file(), address: "two", context: { ...uploadContext, embedded: { title: "Another Work", artist: "Artist" } } }, changedClue.deps);
    await identifyImage({ file: file(), address: "three", context: { ...uploadContext, originalSize: 99 } }, changedSize.deps);

    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(keys[2]);
  });

  it("keeps museum evidence as the final gate and labels an uncorroborated candidate as a suggestion", async () => {
    const setup = dependencies();
    const result = await identifyImage({ file: file(), address: "test", context: uploadContext }, setup.deps);

    expect(result).toMatchObject({
      state: "SUGGESTION",
      artwork: { title: "A Work", artist: "Artist" }
    });
    expect(result.state).not.toBe("MATCH");
  });
});
