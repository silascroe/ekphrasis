import type { ArtworkCandidate, Confidence } from "../types";
import type { ScoredCandidate } from "./score";
import { equivalentDate, equivalentText } from "./normalize";

export type SelectionResult = {
  candidate: ScoredCandidate | null;
  confidence: Confidence | null;
  ambiguous: boolean;
};

const metadataFields = ["title", "artist", "year", "medium"] as const;

function populated(candidate: ArtworkCandidate): number {
  return metadataFields.filter(field => Boolean(candidate.artwork[field])).length;
}

function stableCandidateKey(candidate: ArtworkCandidate): string {
  return [
    candidate.source.id,
    candidate.source.object_id ?? "",
    candidate.artwork.title ?? "",
    candidate.artwork.artist ?? "",
    candidate.artwork.year ?? ""
  ].join("|");
}

function sameArtwork(a: ArtworkCandidate, b: ArtworkCandidate): boolean {
  if (!equivalentText(a.artwork.title, b.artwork.title)) return false;
  if (!equivalentText(a.artwork.artist, b.artwork.artist)) return false;
  if (a.artwork.year && b.artwork.year && !equivalentDate(a.artwork.year, b.artwork.year)) return false;
  return true;
}

export function selectCanonicalCandidate(candidates: ScoredCandidate[], sourcePriority: string[]): SelectionResult {
  const eligible = candidates.filter(candidate => candidate.strongPositiveCount >= 2 && !candidate.strongNegative);
  if (!eligible.length) return { candidate: null, confidence: null, ambiguous: false };

  const ordered = [...eligible].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const populatedDiff = populated(b) - populated(a);
    if (populatedDiff) return populatedDiff;

    const ai = sourcePriority.indexOf(a.source.id);
    const bi = sourcePriority.indexOf(b.source.id);
    const priorityDiff =
      (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) -
      (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    if (priorityDiff) return priorityDiff;

    return stableCandidateKey(a).localeCompare(stableCandidateKey(b));
  });

  const top = ordered[0];
  const runnerUp = ordered[1];
  const ambiguous = Boolean(
    runnerUp &&
    top.score === runnerUp.score &&
    !sameArtwork(top, runnerUp)
  );

  return {
    candidate: top,
    confidence: ambiguous ? "medium" : top.score >= 9 ? "high" : "medium",
    ambiguous
  };
}
