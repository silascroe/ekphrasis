import type { IdentificationResult, ArtworkCandidate } from "../types";
import type { ResultCache } from "../cache/cache";
import { sha256 } from "../cache/cache";
import { validateUpload, type ValidatedUpload } from "../image/validate";
import { normalizeImage, type NormalizedImage } from "../image/normalize";
import { canonicalUploadContext, type UploadContext } from "../image/upload-context";
import { extractSearchCandidates, type ExtractedArtwork } from "../candidates/extract";
import type { VisionAdapter } from "../vision/types";
import type { MuseumAdapter } from "../museums/types";
import { searchMuseums } from "../museums/search";
import { equivalentDate, equivalentText } from "../matching/normalize";
import { scoreCandidates } from "../matching/score";
import { selectCanonicalCandidate } from "../matching/select";
import type { ClipEncoder, ClipIndex, ClipCandidateRef, QdrantAdapter } from "../clip/types";
import { retrieveFallbackCandidates } from "../clip/fallback";
import { fetchWikipedia } from "../enrichment/wikipedia";
import { fetchWikidataFacts } from "../enrichment/wikidata";
import { normalizeContext, normalizeDetail } from "../enrichment/normalize";
import { extractRelatedReading } from "../enrichment/related-reading";
import type { RateLimitDecision } from "../rate-limit/rate-limit";
import { InputError, ProviderError } from "../errors";

export type IdentifyRequest = { file: File; address: string; context?: UploadContext };

export interface IdentifyDeps {
  cache: ResultCache;
  limiter: { check(identity: string): Promise<RateLimitDecision> };
  validate?: (file: File) => Promise<ValidatedUpload>;
  normalize?: (upload: ValidatedUpload) => Promise<NormalizedImage>;
  vision?: VisionAdapter;
  museums?: MuseumAdapter[];
  clip?: {
    encoder: ClipEncoder;
    qdrant: QdrantAdapter;
    index: ClipIndex;
    hydrate?: (refs: ClipCandidateRef[]) => Promise<ArtworkCandidate[]>;
  };
}

function matchingQueries(value: string | null, queries: string[], predicate: (value: string, query: string) => boolean): string[] {
  if (!value) return [];
  return queries.filter(query => predicate(value, query));
}

function textMatches(value: string | null, queries: string[]): string[] {
  return matchingQueries(value, queries, equivalentText);
}

function dateMatches(value: string | null, queries: string[]): string[] {
  return matchingQueries(
    value,
    queries.filter(query => /^\s*(?:c\.?\s*)?\d{4}\s*$/.test(query)),
    equivalentDate
  );
}

export function evidenceCandidates(
  candidates: ArtworkCandidate[],
  queries: string[],
  extracted: ExtractedArtwork = {}
): ArtworkCandidate[] {
  const compare = (
    candidateValue: string | null,
    extractedValue: string | null | undefined,
    support: string[],
    predicate: (left: string, right: string) => boolean
  ) => {
    if (!candidateValue) return "UNAVAILABLE" as const;
    if (extractedValue) return predicate(candidateValue, extractedValue) ? "MATCH" as const : "MISMATCH" as const;
    return support.length ? "MATCH" as const : "UNAVAILABLE" as const;
  };

  return candidates.map(candidate => {
    const titleSupport = textMatches(candidate.artwork.title, queries);
    const artistSupport = textMatches(candidate.artwork.artist, queries);
    const dateSupport = dateMatches(candidate.artwork.year, queries);
    const mediumSupport = textMatches(candidate.artwork.medium, queries);

    return {
      ...candidate,
      evidence: {
        vision_text_match: "UNAVAILABLE",
        title_match: compare(candidate.artwork.title, extracted.title, titleSupport, equivalentText),
        artist_match: compare(candidate.artwork.artist, extracted.artist, artistSupport, equivalentText),
        date_match: compare(candidate.artwork.year, extracted.year, dateSupport, equivalentDate),
        medium_match: compare(candidate.artwork.medium, extracted.medium, mediumSupport, equivalentText),
        image_similarity: "UNAVAILABLE"
      },
      evidence_support: {
        title_match: titleSupport,
        artist_match: artistSupport,
        date_match: dateSupport,
        medium_match: mediumSupport
      }
    };
  });
}

async function enrich(candidate: ArtworkCandidate): Promise<{ context: string | null; detail: string | null; related_reading: Array<{ title: string; url: string }> }> {
  try {
    const article = await fetchWikipedia(candidate.artwork.title ?? candidate.artwork.artist ?? "");
    const facts = await fetchWikidataFacts(candidate.artwork.title ?? candidate.artwork.artist ?? "");
    return {
      context: normalizeContext([...(article?.extract ? [article.extract] : []), ...facts]),
      detail: normalizeDetail(facts),
      related_reading: extractRelatedReading(
        (article?.externallinks ?? []).map(url => ({ title: new URL(url).hostname.replace(/^www\./, ""), url }))
      )
    };
  } catch {
    return { context: null, detail: null, related_reading: [] };
  }
}

async function hydrateClipRefs(
  refs: ClipCandidateRef[],
  deps: IdentifyDeps
): Promise<ArtworkCandidate[]> {
  const embedded = refs.flatMap(ref => ref.candidate ? [ref.candidate] : []);
  if (embedded.length === refs.length || !deps.clip?.hydrate) return embedded;

  const hydrated = await deps.clip.hydrate(refs);
  return [...embedded, ...hydrated];
}

export async function identifyImage(request: IdentifyRequest, deps: IdentifyDeps): Promise<IdentificationResult> {
  const rate = await deps.limiter.check(request.address);
  if (!rate.allowed) return { state: "ERROR", error: "PROCESSING_FAILED" };

  if (request.file.size === 0 || request.file.size > 10 * 1024 * 1024) {
    return { state: "ERROR", error: "UNSUPPORTED_INPUT" };
  }

  const originalBytes = new Uint8Array(await request.file.arrayBuffer());
  const imageHash = await sha256(originalBytes);
  const hash = await sha256(Buffer.from(JSON.stringify({ imageHash, context: canonicalUploadContext(request.context) }), "utf8"));
  try {
    const cached = await deps.cache.get(hash);
    if (cached) return cached;
  } catch {
    // Cache is an optimization; recognition must remain available if it is down.
  }

  try {
    const upload = await (deps.validate ?? validateUpload)(request.file);
    const image = await (deps.normalize ?? normalizeImage)(upload);

    if (!deps.vision || !deps.museums) throw new ProviderError("vision", "PROVIDER_ERROR", "Recognition providers are not configured.");

    const detection = await deps.vision.detect({ image: image.bytes, context: request.context });
    const queries = extractSearchCandidates(detection);
    const museumResult = await searchMuseums(deps.museums, queries);
    let candidates = evidenceCandidates(museumResult.candidates, queries, detection.extracted);
    let selection = selectCanonicalCandidate(scoreCandidates(candidates), ["met", "rijksmuseum", "aic", "smithsonian"]);

    if (!selection.candidate && deps.clip) {
      try {
        const fallback = await retrieveFallbackCandidates(
          image.bytes,
          deps.clip.index,
          deps.clip.encoder,
          deps.clip.qdrant,
          refs => hydrateClipRefs(refs, deps)
        );
        candidates = evidenceCandidates(fallback, queries, detection.extracted);
        selection = selectCanonicalCandidate(scoreCandidates(candidates), ["met", "rijksmuseum", "aic", "smithsonian"]);
      } catch {
        // Qdrant/CLIP is non-critical; continue to NO_MATCH.
      }
    }

    const suggestedIdentity = detection.extracted?.title?.trim() || detection.extracted?.artist?.trim();
    const result: IdentificationResult = selection.candidate
      ? {
          state: "MATCH",
          confidence: selection.confidence ?? "medium",
          artwork: selection.candidate.artwork,
          source: selection.candidate.source,
          ...(await enrich(selection.candidate)),
          degraded: museumResult.unavailableSources.length > 0,
          unavailable_sources: museumResult.unavailableSources
        }
      : suggestedIdentity
        ? {
            state: "SUGGESTION",
            confidence: detection.research?.confidence ?? "low",
            artwork: {
              title: detection.extracted?.title ?? null,
              artist: detection.extracted?.artist ?? null,
              year: detection.extracted?.year ?? null,
              medium: detection.extracted?.medium ?? null,
              style: null
            },
            candidates: [...new Set((detection.webDetection?.webEntities ?? [])
              .map(item => item.description?.trim())
              .filter((value): value is string => Boolean(value)))].slice(0, 8),
            source_urls: detection.research?.sourceUrls ?? [],
            evidence: detection.research?.evidence ?? [],
            unavailable_sources: museumResult.unavailableSources
          }
      : {
          state: "NO_MATCH",
          reason: "insufficient_evidence",
          degraded: museumResult.unavailableSources.length > 0,
          unavailable_sources: museumResult.unavailableSources
        };

    try {
      await deps.cache.set(hash, result);
    } catch {
      // Cache write failures do not invalidate an otherwise valid recognition result.
    }
    return result;
  } catch (error) {
    const result: IdentificationResult =
      error instanceof InputError
        ? { state: "ERROR", error: error.code }
        : error instanceof ProviderError && error.provider === "vision"
          ? { state: "ERROR", error: "API_UNAVAILABLE" }
          : { state: "ERROR", error: "PROCESSING_FAILED" };
    return result;
  }
}
