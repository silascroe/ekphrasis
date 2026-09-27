import type { ArtworkCandidate } from "../types";
import type { Fetcher, MuseumAdapter } from "./types";
import { requestJson } from "./request";

export class ArticAdapter implements MuseumAdapter {
  id = "aic";
  name = "Art Institute of Chicago";
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async getById(id: string): Promise<ArtworkCandidate | null> {
    const json = await requestJson<{ data?: Record<string, unknown> }>(
      this.fetcher,
      `https://api.artic.edu/api/v1/artworks/${encodeURIComponent(id)}?fields=id,title,date_display,artist_display,medium_display,style_title,image_id,is_public_domain`,
      this.id
    );
    const record = json.data;
    if (!record) return null;
    const imageId = typeof record.image_id === "string" ? record.image_id : null;
    return {
      source: {
        id: this.id,
        name: this.name,
        object_id: idOrNull(record.id),
        image_url: imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/843,/0/default.jpg` : null,
        url: typeof record.id === "number" ? `https://www.artic.edu/artworks/${record.id}` : null,
        license: { status: record.is_public_domain === true ? "public-domain" : "unknown", details: null }
      },
      artwork: { title: stringOrNull(record.title), artist: stringOrNull(record.artist_display), year: stringOrNull(record.date_display), medium: stringOrNull(record.medium_display), style: stringOrNull(record.style_title) },
      evidence: emptyEvidence()
    };
  }

  async search(query: string): Promise<ArtworkCandidate[]> {
    const url = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&limit=5&fields=id,title,date_display,artist_display,medium_display,style_title,image_id,is_public_domain`;
    const json = await requestJson<{ data?: Array<Record<string, unknown>> }>(this.fetcher, url, this.id);
    return (json.data ?? []).map(record => {
      const imageId = typeof record.image_id === "string" ? record.image_id : null;
      return {
        source: {
        id: this.id,
        name: this.name,
        object_id: idOrNull(record.id),
        image_url: imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/843,/0/default.jpg` : null,
        url: typeof record.id === "number" ? `https://www.artic.edu/artworks/${record.id}` : null,
        license: { status: record.is_public_domain === true ? "public-domain" : "unknown", details: null }
      },
        artwork: {
          title: stringOrNull(record.title),
          artist: stringOrNull(record.artist_display),
          year: stringOrNull(record.date_display),
          medium: stringOrNull(record.medium_display),
          style: stringOrNull(record.style_title)
        },
        evidence: emptyEvidence()
      };
    });
  }
}
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function idOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringOrNull(value);
}
function emptyEvidence() { return { vision_text_match: "UNAVAILABLE", artist_match: "UNAVAILABLE", title_match: "UNAVAILABLE", date_match: "UNAVAILABLE", medium_match: "UNAVAILABLE", image_similarity: "UNAVAILABLE" } as const; }
