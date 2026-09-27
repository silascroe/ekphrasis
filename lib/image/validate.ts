import heicConvert from "heic-convert";
import sharp from "sharp";
import { InputError } from "../errors";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const SUPPORTED = new Set(["jpeg", "png", "webp", "heic", "heif"]);

export type HeicConverter = (options: {
  buffer: Uint8Array;
  format: "JPEG";
  quality?: number;
}) => Promise<Uint8Array>;

export type ValidatedUpload = {
  bytes: Buffer;
  decodedBytes?: Buffer;
  format: "jpeg" | "png" | "webp" | "heic" | "heif";
  width: number;
  height: number;
};

function sniff(bytes: Buffer): ValidatedUpload["format"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "heic";
    if (["heif", "heis"].includes(brand)) return "heif";
  }
  return null;
}

export async function validateUpload(
  file: File,
  convertHeic: HeicConverter = heicConvert
): Promise<ValidatedUpload> {
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new InputError("UNSUPPORTED_INPUT", "Image exceeds the upload resource limit.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const format = sniff(bytes);

  if (!format || !SUPPORTED.has(format)) {
    throw new InputError("INVALID_IMAGE", "The uploaded file is not a supported image.");
  }

  try {
    const decodedBytes = format === "heic" || format === "heif"
      ? Buffer.from(await convertHeic({ buffer: bytes, format: "JPEG", quality: 0.9 }))
      : undefined;
    const metadata = await sharp(decodedBytes ?? bytes, { failOn: "error" }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (!width || !height || width * height > MAX_PIXELS) {
      throw new InputError("INVALID_IMAGE", "The image dimensions exceed the supported resource limit.");
    }

    return { bytes, decodedBytes, format, width, height };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("INVALID_IMAGE", "The uploaded image could not be decoded.");
  }
}
