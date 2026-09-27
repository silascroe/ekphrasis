import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchWikipedia } from "../../lib/enrichment/wikipedia";
import { fetchWikidataFacts } from "../../lib/enrichment/wikidata";

afterEach(() => vi.restoreAllMocks());

describe("enrichment adapters", () => {
  it("maps Wikipedia summaries and external links", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ extract: "A concise context." })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        query: { pages: { "1": { extlinks: [{ "*": "https://example.org/reading" }] } } }
      })));
    await expect(fetchWikipedia("Example")).resolves.toMatchObject({
      extract: "A concise context.",
      externallinks: ["https://example.org/reading"]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps Wikidata descriptions into facts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ search: [{ description: "Dutch painter" }] }))
    );
    await expect(fetchWikidataFacts("Artist")).resolves.toEqual(["Dutch painter"]);
  });

  it("classifies Wikipedia aborts as timeouts", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(fetchWikipedia("Example")).rejects.toMatchObject({
      provider: "wikipedia",
      failure: "TIMEOUT"
    });
  });

  it("bounds Wikidata requests and classifies timeout failures", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(fetchWikidataFacts("Artist")).rejects.toMatchObject({
      provider: "wikidata",
      failure: "TIMEOUT"
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
