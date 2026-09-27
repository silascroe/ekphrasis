import type { ArtworkCandidate, Evidence, EvidenceState } from "../types";

export type ScoredCandidate = ArtworkCandidate & {
  score: number;
  strongPositiveCount: number;
  strongNegative: boolean;
};

const weight: Record<Exclude<EvidenceState, "UNAVAILABLE">, number> = {
  MATCH: 3,
  MISMATCH: -4
};

function independentSupportCount(candidate: ArtworkCandidate): number {
  const support = candidate.evidence_support ?? {};
  const entries = (Object.entries(candidate.evidence) as Array<[keyof Evidence, EvidenceState]>)
    .filter(([, state]) => state === "MATCH")
    .map(([dimension]) => {
      const signals = support[dimension];
      return [
        dimension,
        signals?.length ? signals : [`__dimension:${dimension}`]
      ] as const;
    });

  const byDimension = new Map(entries);
  const signalOwner = new Map<string, keyof Evidence>();

  function assign(dimension: keyof Evidence, seenSignals: Set<string>): boolean {
    for (const signal of byDimension.get(dimension) ?? []) {
      if (seenSignals.has(signal)) continue;
      seenSignals.add(signal);

      const owner = signalOwner.get(signal);
      if (!owner || assign(owner, seenSignals)) {
        signalOwner.set(signal, dimension);
        return true;
      }
    }
    return false;
  }

  let count = 0;
  for (const [dimension] of entries) {
    if (assign(dimension, new Set())) count += 1;
  }
  return count;
}

export function scoreCandidates(candidates: ArtworkCandidate[]): ScoredCandidate[] {
  return candidates.map(candidate => {
    const states = Object.values(candidate.evidence);
    const strongPositiveCount = independentSupportCount(candidate);
    const strongNegative = states.includes("MISMATCH");
    const score = states.reduce(
      (total, state) => state === "UNAVAILABLE" ? total : total + weight[state],
      0
    );
    return { ...candidate, score, strongPositiveCount, strongNegative };
  });
}
