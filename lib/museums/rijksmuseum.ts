import type { ArtworkCandidate } from "../types";
import type { Fetcher, MuseumAdapter } from "./types";
import { ProviderError } from "../errors";
import { requestJson } from "./request";

export class RijksmuseumAdapter implements MuseumAdapter {
  id = "rijksmuseum";
  name = "Rijksmuseum";
  constructor(private readonly fetcher: Fetcher = fetch, private readonly apiKey = process.env.RIJKSMUSEUM_API_KEY ?? "") {}
  async getById(id: string): Promise<ArtworkCandidate | null> {
    if (!this.apiKey) throw new ProviderError(this.id, "AUTH", "Rijksmuseum API key is not configured.");
    const record = await requestJson<Record<string, unknown>>(
      this.fetcher,
      `https://www.rijksmuseum.nl/api/en/collection/${encodeURIComponent(id)}?key=${encodeURIComponent(this.apiKey)}`,
      this.id
    );
    const artObject = typeof record.artObject === "object" && record.artObject ? record.artObject as Record<string, unknown> : record;
    const webImage = typeof artObject.webImage === "object" && artObject.webImage ? artObject.webImage as Record<string, unknown> : {};
    return {
      source: {
        id: this.id,
        name: this.name,
        object_id: stringOrNull(artObject.objectNumber) ?? stringOrNull(artObject.id),
        image_url: stringOrNull(webImage.url),
        url: stringOrNull(artObject.links && typeof artObject.links === "object" ? (artObject.links as Record<string, unknown>).web : null),
        license: { status: "unknown", details: null }
      },
      artwork: { title: stringOrNull(artObject.title), artist: stringOrNull(artObject.principalOrFirstMaker), year: stringOrNull(artObject.dating && typeof artObject.dating === "object" ? (artObject.dating as Record<string, unknown>).presentingDate : null), medium: null, style: null },
      evidence: emptyEvidence()
    };
  }

  async search(query: string): Promise<ArtworkCandidate[]> {
    if (!this.apiKey) throw new ProviderError(this.id, "AUTH", "Rijksmuseum API key is not configured.");
    const json = await requestJson<{ artObjects?: Array<Record<string, unknown>> }>(
      this.fetcher,
      `https://www.rijksmuseum.nl/api/en/collection?key=${encodeURIComponent(this.apiKey)}&q=${encodeURIComponent(query)}&ps=5&imgonly=true`,
      this.id
    );
    return (json.artObjects ?? []).map(record => {
      const webImage = typeof record.webImage === "object" && record.webImage ? record.webImage as Record<string, unknown> : {};
      return {
        source: {
          id: this.id,
          name: this.name,
          object_id: stringOrNull(record.objectNumber) ?? stringOrNull(record.id),
          image_url: stringOrNull(webImage.url),
          url: stringOrNull(record.links && typeof record.links === "object" ? (record.links as Record<string, unknown>).web : null),
          license: { status: "unknown", details: null }
        },
        artwork: { title: stringOrNull(record.title), artist: stringOrNull(record.principalOrFirstMaker), year: null, medium: null, style: null },
        evidence: emptyEvidence()
      };
    });
  }
}
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function emptyEvidence() { return { vision_text_match: "UNAVAILABLE", artist_match: "UNAVAILABLE", title_match: "UNAVAILABLE", date_match: "UNAVAILABLE", medium_match: "UNAVAILABLE", image_similarity: "UNAVAILABLE" } as const; }
