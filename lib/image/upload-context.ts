import { readEmbeddedMetadata } from "./metadata";

const FIELD_LIMITS = {
  title: 500,
  description: 2000,
  artist: 500,
  copyright: 1000,
  subject: 1000,
  documentName: 500,
  comment: 1000
} as const;

export type EmbeddedArtworkMetadata = Partial<Record<keyof typeof FIELD_LIMITS, string>>;

export type UploadContext = {
  originalFilename: string;
  originalMimeType: string | null;
  originalSize: number;
  embedded?: EmbeddedArtworkMetadata;
};

type MetadataRecord = Record<string, unknown>;

function record(value: unknown): MetadataRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetadataRecord
    : {};
}

function at(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) current = record(current)[key];
  return current;
}

function metadataText(value: unknown, maxLength: number): string | undefined {
  if (Array.isArray(value)) {
    const values = value.map(item => metadataText(item, maxLength)).filter((item): item is string => Boolean(item));
    return values.length ? values.join("; ").slice(0, maxLength) : undefined;
  }

  if (value && typeof value === "object") {
    const object = record(value);
    return metadataText(object.value ?? object._, maxLength);
  }

  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function firstText(metadata: unknown, candidates: Array<unknown>, maxLength: number): string | undefined {
  for (const value of candidates) {
    const text = metadataText(value, maxLength);
    if (text) return text;
  }
  return undefined;
}

function selectEmbeddedMetadata(value: unknown): EmbeddedArtworkMetadata | undefined {
  const raw = record(value);
  const ifd0 = record(raw.ifd0);
  const exif = record(raw.exif);
  const iptc = record(raw.iptc);
  const xmp = record(raw.xmp);
  const dc = record(xmp.dc ?? raw.dc);

  const embedded: EmbeddedArtworkMetadata = {
    title: firstText(raw, [ifd0.XPTitle, ifd0.ImageTitle, iptc.ObjectName, dc.title, raw.XPTitle, raw.Title], FIELD_LIMITS.title),
    description: firstText(raw, [ifd0.ImageDescription, iptc["Caption-Abstract"], iptc.Caption, dc.description, raw.ImageDescription], FIELD_LIMITS.description),
    artist: firstText(raw, [exif.Artist, iptc.Byline, iptc["By-line"], dc.creator, raw.Artist], FIELD_LIMITS.artist),
    copyright: firstText(raw, [exif.Copyright, iptc.CopyrightNotice, dc.rights, raw.Copyright], FIELD_LIMITS.copyright),
    subject: firstText(raw, [iptc.Keywords, dc.subject, raw.Subject], FIELD_LIMITS.subject),
    documentName: firstText(raw, [ifd0.DocumentName, iptc.DocumentName, raw.DocumentName], FIELD_LIMITS.documentName),
    comment: firstText(raw, [exif.UserComment, raw.UserComment], FIELD_LIMITS.comment)
  };

  return Object.values(embedded).some(Boolean) ? embedded : undefined;
}

export async function extractUploadContext(file: File): Promise<UploadContext> {
  const context: UploadContext = {
    originalFilename: file.name.slice(0, 512),
    originalMimeType: file.type.trim().slice(0, 128) || null,
    originalSize: Number.isFinite(file.size) && file.size >= 0 ? file.size : 0
  };

  try {
    const embedded = selectEmbeddedMetadata(await readEmbeddedMetadata(file));
    if (embedded) context.embedded = embedded;
  } catch {
    // Embedded metadata is optional; a parser failure must not block image upload.
  }

  return context;
}

function stableEmbedded(metadata?: EmbeddedArtworkMetadata): EmbeddedArtworkMetadata | undefined {
  if (!metadata) return undefined;
  const ordered = Object.keys(FIELD_LIMITS).sort() as Array<keyof EmbeddedArtworkMetadata>;
  const result: EmbeddedArtworkMetadata = {};
  for (const key of ordered) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) result[key] = value.trim();
  }
  return Object.keys(result).length ? result : undefined;
}

export function canonicalUploadContext(context?: UploadContext): string {
  if (!context) return "";
  return JSON.stringify({
    originalFilename: context.originalFilename,
    originalMimeType: context.originalMimeType,
    embedded: stableEmbedded(context.embedded)
  });
}
