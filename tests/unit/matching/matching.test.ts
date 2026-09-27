import { describe, expect, it } from "vitest";
import { buildEvidence } from "../../../lib/matching/evidence";
import { selectCanonicalCandidate } from "../../../lib/matching/select";
import { scoreCandidates } from "../../../lib/matching/score";

const base = (id = "met") => ({
  source: { id, name: id, image_url: null, url: null },
  artwork: { title: "The Starry Night", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", style: null },
  evidence: { vision_text_match: "UNAVAILABLE" as const, artist_match: "MATCH" as const, title_match: "MATCH" as const, date_match: "UNAVAILABLE" as const, medium_match: "UNAVAILABLE" as const, image_similarity: "UNAVAILABLE" as const }
});

describe("deterministic matching", () => {
  it("treats an absent year as neutral", () => {
    const evidence = buildEvidence(
      { title: "The Starry Night", artist: "Vincent van Gogh", year: null, medium: "Oil on canvas" },
      { title: "The Starry Night", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas" }
    );
    expect(evidence.date_match).toBe("UNAVAILABLE");
  });

  it("treats museum artist display suffixes as equivalent rather than conflicting", () => {
    const evidence = buildEvidence(
      { title: "The Starry Night", artist: "Vincent van Gogh, Dutch, 1853–1890", year: "1889", medium: "Oil on canvas" },
      { title: "Starry Night", artist: "Vincent van Gogh", year: "1889", medium: "oil on canvas" }
    );
    expect(evidence.artist_match).toBe("MATCH");
    expect(evidence.title_match).toBe("MATCH");
  });

  it("selects the same canonical source regardless of arrival order", () => {
    const a = base("met"); const b = base("aic");
    expect(selectCanonicalCandidate(scoreCandidates([a, b]), ["met", "aic"]).candidate?.source.id)
      .toBe(selectCanonicalCandidate(scoreCandidates([b, a]), ["met", "aic"]).candidate?.source.id);
  });
});