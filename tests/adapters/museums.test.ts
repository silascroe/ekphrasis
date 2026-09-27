import { describe, expect, it, vi } from "vitest";
import { MetAdapter } from "../../lib/museums/met";
import { ArticAdapter } from "../../lib/museums/artic";
import { SmithsonianAdapter } from "../../lib/museums/smithsonian";
import { searchMuseums } from "../../lib/museums/search";

describe("museum adapters", () => {
  it("maps a Met record while preserving absent fields as null", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ objectIDs: [1] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        objectID: 1,
        title: "Starry Night",
        artistDisplayName: "Vincent van Gogh",
        objectDate: "1889",
        medium: "Oil on canvas",
        primaryImage: "https://example.com/met.jpg"
      })));
    const adapter = new MetAdapter(fetcher as typeof fetch);
    const results = await adapter.search("Starry Night");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/public/collection/v1.1/search");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("limit=5");
    expect(results[0].artwork.style).toBeNull();
    expect(results[0].artwork.year).toBe("1889");
  });

  it("maps Smithsonian nested media and descriptive metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: {
        rows: [{
          title: "Example Painting",
          content: {
            descriptiveNonRepeating: {
              record_link: "https://example.si.edu/object/1",
              online_media: {
                media: [{ type: "Images", content: "https://ids.si.edu/example.jpg" }]
              }
            },
            indexedStructured: { date: ["1889"] },
            freetext: {
              physicalDescription: [{ label: "Medium", content: "Oil on canvas" }]
            }
          }
        }]
      }
    })));
    const adapter = new SmithsonianAdapter(fetcher as typeof fetch, "test-key");
    const result = await adapter.search("Example Painting");
    expect(result[0].source.image_url).toBe("https://ids.si.edu/example.jpg");
    expect(result[0].source.url).toBe("https://example.si.edu/object/1");
    expect(result[0].artwork.year).toBe("1889");
    expect(result[0].artwork.medium).toBe("Oil on canvas");
  });

  it("prefers AIC style_title when present", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        id: 10,
        title: "Example",
        artist_display: "Artist",
        date_display: "1900",
        medium_display: "Oil",
        style_title: "Impressionism",
        image_id: "abc"
      }]
    })));
    const adapter = new ArticAdapter(fetcher as typeof fetch);
    const result = await adapter.search("Example");
    expect(result[0].artwork.style).toBe("Impressionism");
  });

  it("preserves successful queries when another query for the same museum fails", async () => {
    const record = {
      source: { id: "met", name: "The Met", image_url: null, url: null },
      artwork: { title: "Example", artist: "Artist", year: null, medium: null, style: null },
      evidence: {
        vision_text_match: "UNAVAILABLE" as const,
        artist_match: "UNAVAILABLE" as const,
        title_match: "UNAVAILABLE" as const,
        date_match: "UNAVAILABLE" as const,
        medium_match: "UNAVAILABLE" as const,
        image_similarity: "UNAVAILABLE" as const
      }
    };
    const adapter = {
      id: "met",
      name: "The Met",
      search: vi.fn(async (query: string) => {
        if (query === "bad") throw new Error("temporary failure");
        return [record];
      })
    };

    const result = await searchMuseums([adapter], ["good", "bad"]);
    expect(result.candidates).toEqual([record]);
    expect(result.unavailableSources).toEqual(["met"]);
  });
});