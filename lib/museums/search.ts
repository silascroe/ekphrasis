import type { ArtworkCandidate } from "../types";
import type { MuseumAdapter } from "./types";

export type MuseumSearchResult = {
  candidates: ArtworkCandidate[];
  unavailableSources: string[];
};

export async function searchMuseums(
  adapters: MuseumAdapter[],
  queries: string[]
): Promise<MuseumSearchResult> {
  const uniqueQueries = [...new Set(queries.filter(Boolean))].slice(0, 6);

  const results = await Promise.all(
    adapters.map(async adapter => {
      const queryResults = await Promise.allSettled(
        uniqueQueries.map(query => adapter.search(query))
      );
      return {
        candidates: queryResults.flatMap(result =>
          result.status === "fulfilled" ? result.value : []
        ),
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
