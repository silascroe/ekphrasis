import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateUpload } from "../../../lib/image/validate";

function file(bytes: number[], name = "image.jpg", type = "image/jpeg") {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("image intake", () => {
  it("rejects an extension/content-type mismatch", async () => {
    await expect(validateUpload(file([0, 1, 2], "photo.jpg", "image/jpeg"))).rejects.toMatchObject({
      code: "INVALID_IMAGE"
    });
  });

  it("rejects an upload over 10 MB", async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(validateUpload(new File([bytes], "large.jpg", { type: "image/jpeg" }))).rejects.toMatchObject({
      code: "UNSUPPORTED_INPUT"
    });
  });

  it("rejects decoded dimensions above the resource guard", async () => {
    await expect(validateUpload(file([255, 216, 255, 224, 0, 16, 74, 70], "huge.jpg"))).rejects.toMatchObject({
      code: "INVALID_IMAGE"
    });
  });

  it("converts HEIC before metadata validation when native sharp support is unavailable", async () => {
    const converted = await sharp({
      create: { width: 2, height: 3, channels: 3, background: { r: 0, g: 0, b: 0 } }
    }).jpeg().toBuffer();
    const convertHeic = vi.fn(async () => new Uint8Array(converted));
    const heicBytes = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftyp"),
      Buffer.from("heic"),
      Buffer.from([0, 0, 0, 0])
    ]);

    const upload = await validateUpload(
      new File([heicBytes], "photo.heic", { type: "image/heic" }),
      convertHeic
    );

    expect(convertHeic).toHaveBeenCalledOnce();
    expect(upload.format).toBe("heic");
    expect(upload.width).toBe(2);
    expect(upload.height).toBe(3);
    expect(upload.decodedBytes).toBeInstanceOf(Buffer);
  });
});
