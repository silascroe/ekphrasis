import type { ArtworkCandidate } from "../types";
import type { Fetcher, MuseumAdapter } from "./types";
import { requestJson } from "./request";

export class MetAdapter implements MuseumAdapter {
  id = "met";
  name = "The Metropolitan Museum of Art";
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async getById(id: string): Promise<ArtworkCandidate | null> {
    const record = await requestJson<Record<string, unknown>>(
      this.fetcher,
      `https://collectionapi.metmuseum.org/public/collection/v1/objects/${encodeURIComponent(id)}`,
      this.id
    );
    return {
      source: { id: this.id, name: this.name, image_url: stringOrNull(record.primaryImage), url: stringOrNull(record.objectURL) },
      artwork: { title: stringOrNull(record.title), artist: stringOrNull(record.artistDisplayName), year: stringOrNull(record.objectDate), medium: stringOrNull(record.medium), style: null },
      evidence: emptyEvidence()
    };
  }

  async search(query: string): Promise<ArtworkCandidate[]> {
    const search = await requestJson<{ objectIDs?: number[] }>(
      this.fetcher,
      `https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=${encodeURIComponent(query)}&hasImages=true&limit=5`,
      this.id
    );
    const ids = (search.objectIDs ?? []).slice(0, 5);
    const details = await Promise.all(ids.map(id =>
      requestJson<Record<string, unknown>>(
        this.fetcher,
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
        this.id
      )
    ));
    return details.map(record => ({
      source: { id: this.id, name: this.name, image_url: stringOrNull(record.primaryImage), url: stringOrNull(record.objectURL) },
      artwork: {
        title: stringOrNull(record.title),
        artist: stringOrNull(record.artistDisplayName),
        year: stringOrNull(record.objectDate),
        medium: stringOrNull(record.medium),
        style: null
      },
      evidence: emptyEvidence()
    }));
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function emptyEvidence() {
  return { vision_text_match: "UNAVAILABLE", artist_match: "UNAVAILABLE", title_match: "UNAVAILABLE", date_match: "UNAVAILABLE", medium_match: "UNAVAILABLE", image_similarity: "UNAVAILABLE" } as const;
}
