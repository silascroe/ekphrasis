import type { ArtworkCandidate } from "../types";
import type { Fetcher, MuseumAdapter } from "./types";
import { ProviderError } from "../errors";
import { requestJson } from "./request";

export class SmithsonianAdapter implements MuseumAdapter {
  id = "smithsonian";
  name = "Smithsonian Open Access";
  constructor(private readonly fetcher: Fetcher = fetch, private readonly apiKey = process.env.SMITHSONIAN_API_KEY ?? "") {}
  async getById(id: string): Promise<ArtworkCandidate | null> {
    if (!this.apiKey) throw new ProviderError(this.id, "AUTH", "Smithsonian API key is not configured.");
    const json = await requestJson<{ response?: { rows?: Array<Record<string, unknown>> } }>(
      this.fetcher,
      `https://api.si.edu/openaccess/api/v1.0/content/${encodeURIComponent(id)}?api_key=${encodeURIComponent(this.apiKey)}`,
      this.id
    );
    const record = json.response?.rows?.[0];
    if (!record) return null;
    return {
      source: {
        id: this.id,
        name: this.name,
        object_id: idOrNull(record.id),
        image_url: extractImage(record),
        url: extractRecordUrl(record),
        license: { status: "unknown", details: null }
      },
      artwork: { title: extractTitle(record), artist: null, year: extractYear(record), medium: extractMedium(record), style: null },
      evidence: emptyEvidence()
    };
  }

  async search(query: string): Promise<ArtworkCandidate[]> {
    if (!this.apiKey) throw new ProviderError(this.id, "AUTH", "Smithsonian API key is not configured.");
    const json = await requestJson<{ response?: { rows?: Array<Record<string, unknown>> } }>(
      this.fetcher,
      `https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(this.apiKey)}&rows=5`,
      this.id
    );
    return (json.response?.rows ?? []).map(record => ({
      source: {
        id: this.id,
        name: this.name,
        object_id: idOrNull(record.id),
        image_url: extractImage(record),
        url: extractRecordUrl(record),
        license: { status: "unknown", details: null }
      },
      artwork: {
        title: extractTitle(record),
        artist: null,
        year: extractYear(record),
        medium: extractMedium(record),
        style: null
      },
      evidence: emptyEvidence()
    }));
  }
}
function extractTitle(record: Record<string, unknown>): string | null {
  const direct = stringOrNull(record.title);
  if (direct) return direct;
  const content = asRecord(record.content);
  return stringOrNull(asRecord(asRecord(content).descriptiveNonRepeating).title) ??
    stringOrNull(asRecord(asRecord(asRecord(content).descriptiveNonRepeating).title).content);
}
function extractRecordUrl(record: Record<string, unknown>): string | null {
  const content = asRecord(record.content);
  const descriptive = asRecord(content.descriptiveNonRepeating);
  return stringOrNull(record.url) ?? stringOrNull(descriptive.record_link);
}
function extractImage(record: Record<string, unknown>): string | null {
  const content = asRecord(record.content);
  const descriptive = asRecord(content.descriptiveNonRepeating);
  const onlineMedia = asRecord(descriptive.online_media);
  const media = Array.isArray(onlineMedia.media) ? onlineMedia.media : [];
  for (const item of media) {
    const mediaRecord = asRecord(item);
    if (stringOrNull(mediaRecord.type)?.toLowerCase() === "images") {
      return stringOrNull(mediaRecord.content) ?? stringOrNull(mediaRecord.thumbnail);
    }
  }
  return null;
}
function extractYear(record: Record<string, unknown>): string | null {
  const content = asRecord(record.content);
  const indexed = asRecord(content.indexedStructured);
  const dates = Array.isArray(indexed.date) ? indexed.date : [];
  return stringOrNull(dates[0]);
}
function extractMedium(record: Record<string, unknown>): string | null {
  const content = asRecord(record.content);
  const freeText = asRecord(content.freetext);
  const descriptions = Array.isArray(freeText.physicalDescription) ? freeText.physicalDescription : [];
  for (const item of descriptions) {
    const value = asRecord(item);
    const label = stringOrNull(value.label)?.toLowerCase();
    if (label === "medium" || label === "physical description") return stringOrNull(value.content);
  }
  return null;
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function idOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringOrNull(value);
}
function emptyEvidence() { return { vision_text_match: "UNAVAILABLE", artist_match: "UNAVAILABLE", title_match: "UNAVAILABLE", date_match: "UNAVAILABLE", medium_match: "UNAVAILABLE", image_similarity: "UNAVAILABLE" } as const; }
