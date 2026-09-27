import type { ArtworkCandidate } from "../types";
import type { MuseumAdapter } from "./types";

export type MuseumSearchResult = {
  candidates: ArtworkCandidate[];
  unavailableSources: string[];
};

function dedupeCandidates(candidates: ArtworkCandidate[]): ArtworkCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate, index) => {
    const key = candidate.source.object_id
      ? `${candidate.source.id}:${candidate.source.object_id}`
      : `${candidate.source.id}:anonymous:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchMuseums(
  adapters: MuseumAdapter[],
  queries: string[]
): Promise<MuseumSearchResult> {
  const uniqueQueries = [...new Set(queries.filter(Boolean))].slice(0, 4);

  const results = await Promise.all(
    adapters.map(async adapter => {
      const queryResults = await Promise.allSettled(
        uniqueQueries.map(query => adapter.search(query))
      );
      return {
        candidates: dedupeCandidates(queryResults.flatMap(result =>
          result.status === "fulfilled" ? result.value : []
        )),
        degraded: queryResults.some(result => result.status === "rejected")
      };
    })
  );

  return {
    candidates: results.flatMap(result => result.candidates),
    unavailableSources: results.flatMap((result, index) =>
      result.degraded ? [adapters[index].id] : []
    )
  };
}
