import sharp from "sharp";
import type { ValidatedUpload } from "./validate";

export type NormalizedImage = {
  bytes: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
};

const MAX_VISION_DIMENSION = 1600;

export async function normalizeImage(upload: ValidatedUpload): Promise<NormalizedImage> {
  const image = sharp(upload.decodedBytes ?? upload.bytes, { failOn: "error" })
    .rotate()
    .resize({
      width: MAX_VISION_DIMENSION,
      height: MAX_VISION_DIMENSION,
      fit: "inside",
      withoutEnlargement: true
    });

  const output = await image.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  return {
    bytes: output.data,
    mimeType: "image/jpeg",
    width: output.info.width,
    height: output.info.height
  };
}
