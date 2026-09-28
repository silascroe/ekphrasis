import { describe, expect, it } from "vitest";
import type { IdentificationResult } from "../../../lib/types";
import { evidenceCandidates, identifyImage } from "../../../lib/pipeline/identify";
import { scoreCandidates } from "../../../lib/matching/score";

const candidate = {
  source: { id: "met", name: "The Met", image_url: null, url: null },
  artwork: { title: "The Starry Night", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", style: null },
  evidence: {
    vision_text_match: "UNAVAILABLE" as const,
    artist_match: "UNAVAILABLE" as const,
    title_match: "UNAVAILABLE" as const,
    date_match: "UNAVAILABLE" as const,
    medium_match: "UNAVAILABLE" as const,
    image_similarity: "UNAVAILABLE" as const
  }
};

describe("identification pipeline", () => {
  it("maps independent Vision text candidates to title and artist evidence without false negatives", () => {
    const [result] = evidenceCandidates([candidate], ["The Starry Night", "Vincent van Gogh"]);
    expect(result.evidence.title_match).toBe("MATCH");
    expect(result.evidence.artist_match).toBe("MATCH");
    expect(result.evidence.date_match).toBe("UNAVAILABLE");
    expect(result.evidence.medium_match).toBe("UNAVAILABLE");
  });

  it("does not count one Vision query as two independent evidence signals", () => {
    const [result] = evidenceCandidates([{
      ...candidate,
      artwork: { title: "Example", artist: "Example", year: null, medium: null, style: null }
    }], ["Example"]);

    expect(result.evidence.title_match).toBe("MATCH");
    expect(result.evidence.artist_match).toBe("MATCH");
    expect(scoreCandidates([result])[0].strongPositiveCount).toBe(1);
  });

  it("does not count multiple equivalent queries for one field as independent evidence", () => {
    const [result] = evidenceCandidates([candidate], ["Starry Night", "The Starry Night"]);
    expect(result.evidence.title_match).toBe("MATCH");
    expect(scoreCandidates([result])[0].strongPositiveCount).toBe(1);
  });

  it("records a populated structured Vision conflict as a mismatch", () => {
    const [result] = evidenceCandidates(
      [candidate],
      ["The Starry Night", "Pablo Picasso"],
      { title: "The Starry Night", artist: "Pablo Picasso", year: null, medium: null }
    );

    expect(result.evidence.title_match).toBe("MATCH");
    expect(result.evidence.artist_match).toBe("MISMATCH");
    expect(scoreCandidates([result])[0].strongNegative).toBe(true);
  });

  it("rejects oversized uploads before reading or hashing them", async () => {
    const result = await identifyImage(
      { file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" }), address: "test" },
      {
        cache: { get: async () => { throw new Error("cache should not run"); }, set: async () => {} },
        limiter: { check: async () => ({ allowed: true }) }
      }
    );
    expect(result).toEqual({ state: "ERROR", error: "UNSUPPORTED_INPUT" });
  });

  it("continues with recognition when the cache backend is unavailable", async () => {
    const result = await identifyImage(
      { file: new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" }), address: "test" },
      {
        cache: {
          get: async () => { throw new Error("cache unavailable"); },
          set: async () => { throw new Error("cache unavailable"); }
        },
        limiter: { check: async () => ({ allowed: true }) },
        validate: async () => ({ bytes: Buffer.from("image"), format: "jpeg", width: 1, height: 1 }),
        normalize: async upload => ({ bytes: upload.bytes, mimeType: "image/jpeg", width: 1, height: 1 }),
        vision: { detect: async () => ({
          extracted: { title: "Example", artist: "Artist", year: null, medium: null },
          webDetection: { webEntities: [{ description: "Example" }, { description: "Artist" }] }
        }) },
        museums: [{
          id: "met",
          name: "The Met",
          search: async () => []
        }],
        clip: {
          index: { version: "v1" },
          encoder: { embed: async () => [0.1, 0.2] },
          qdrant: { search: async () => [{ artworkId: "met:123", score: 0.99 }] },
          hydrate: async refs => {
            expect(refs.map(ref => ref.artworkId)).toEqual(["met:123"]);
            return [{
              source: { id: "met", name: "The Met", image_url: null, url: null },
              artwork: { title: "Example", artist: "Artist", year: null, medium: null, style: null },
              evidence: {
                vision_text_match: "UNAVAILABLE",
                artist_match: "UNAVAILABLE",
                title_match: "UNAVAILABLE",
                date_match: "UNAVAILABLE",
                medium_match: "UNAVAILABLE",
                image_similarity: "UNAVAILABLE"
              }
            }];
          }
        }
      }
    );
    expect(result.state).toBe("MATCH");
  });

  it("returns an explicitly unverified Codex suggestion when museum lookup has no confirmed match", async () => {
    const result = await identifyImage(
      { file: new File([new Uint8Array([1])], "mona-lisa.jpg", { type: "image/jpeg" }), address: "test" },
      {
        cache: { get: async () => null, set: async () => {} },
        limiter: { check: async () => ({ allowed: true }) },
        validate: async () => ({ bytes: Buffer.from("image"), format: "jpeg", width: 1, height: 1 }),
        normalize: async upload => ({ bytes: upload.bytes, mimeType: "image/jpeg", width: 1, height: 1 }),
        vision: { detect: async () => ({
          extracted: { title: "Mona Lisa", artist: "Leonardo da Vinci", year: "c. 1503–1519", medium: "Oil on poplar", },
          research: { confidence: "high", sourceUrls: ["https://www.louvre.fr/en/explore/the-palace/mona-lisa"], evidence: ["The portrait is identified as the Mona Lisa."] },
          webDetection: { webEntities: [{ description: "Mona Lisa" }, { description: "Leonardo da Vinci" }] }
        }) },
        museums: [{ id: "met", name: "The Met", search: async () => [] }]
      }
    );

    expect(result).toMatchObject({
      state: "SUGGESTION",
      confidence: "high",
      artwork: { title: "Mona Lisa", artist: "Leonardo da Vinci" },
      source_urls: ["https://www.louvre.fr/en/explore/the-palace/mona-lisa"],
      unavailable_sources: []
    });
  });

  it("returns a cached result without invoking providers", async () => {
    const cached: IdentificationResult = { state: "NO_MATCH", reason: "insufficient_evidence", degraded: false, unavailable_sources: [] };
    const result = await identifyImage(
      { file: new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" }), address: "test" },
      {
        cache: { get: async () => cached, set: async () => {} },
        limiter: { check: async () => ({ allowed: true }) }
      }
    );
    expect(result).toEqual(cached);
  });
});
