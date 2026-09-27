const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_DIMENSION = 1600;

export type DecodedClientImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
};

export type ClientImageDeps = {
  decode(file: File): Promise<DecodedClientImage>;
  encode(source: CanvasImageSource, width: number, height: number): Promise<Blob>;
};

async function decodeWithBrowser(file: File): Promise<DecodedClientImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close()
      };
    } catch {
      // Safari can decode some camera formats through <img> even when createImageBitmap cannot.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The selected image could not be decoded."));
      image.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url)
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function encodeWithCanvas(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image conversion is unavailable in this browser.");
  context.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  );
  if (!blob) throw new Error("The selected image could not be converted.");
  return blob;
}

const browserDeps: ClientImageDeps = {
  decode: decodeWithBrowser,
  encode: encodeWithCanvas
};

function jpegName(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".jpg";
}

export async function prepareUploadFile(
  file: File,
  deps: ClientImageDeps = browserDeps
): Promise<File> {
  if (file.size <= DIRECT_UPLOAD_LIMIT) return file;
  if (file.size > MAX_SOURCE_BYTES) throw new Error("The selected image is too large.");

  const decoded = await deps.decode(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error("The selected image has invalid dimensions.");

    const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const blob = await deps.encode(decoded.source, width, height);

    if (blob.size > DIRECT_UPLOAD_LIMIT) {
      throw new Error("The converted image is still too large to upload.");
    }

    return new File([blob], jpegName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified
    });
  } finally {
    decoded.dispose();
  }
}
