export type EvidenceState = "MATCH" | "MISMATCH" | "UNAVAILABLE";
export type PublicState = "MATCH" | "SUGGESTION" | "NO_MATCH" | "ERROR";
export type Confidence = "high" | "medium" | "low";
export type ProviderFailureClass =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH"
  | "NOT_FOUND"
  | "INVALID_RESPONSE"
  | "NETWORK"
  | "PROVIDER_ERROR";

export type Evidence = {
  vision_text_match: EvidenceState;
  artist_match: EvidenceState;
  title_match: EvidenceState;
  date_match: EvidenceState;
  medium_match: EvidenceState;
  image_similarity: EvidenceState;
};

export type ArtworkCandidate = {
  source: {
    id: string;
    name: string;
    object_id?: string | null;
    image_url: string | null;
    url: string | null;
    license?: {
      status: "public-domain" | "restricted" | "unknown";
      details: string | null;
    };
  };
  artwork: {
    title: string | null;
    artist: string | null;
    year: string | null;
    medium: string | null;
    style: string | null;
  };
  evidence: Evidence;
  /** Internal provenance for evidence matches; omitted on candidates created outside the Vision pipeline. */
  evidence_support?: Partial<Record<keyof Evidence, string[]>>;
};

export type IdentificationResult =
  | {
      state: "MATCH";
      confidence: Confidence;
      artwork: ArtworkCandidate["artwork"];
      source: ArtworkCandidate["source"];
      context: string | null;
      detail: string | null;
      related_reading: Array<{ title: string; url: string }>;
      degraded: boolean;
      unavailable_sources: string[];
    }
  | {
      state: "NO_MATCH";
      reason: "insufficient_evidence";
      degraded: boolean;
      unavailable_sources: string[];
    }
  | {
      state: "SUGGESTION";
      confidence: Confidence;
      artwork: ArtworkCandidate["artwork"];
      candidates: string[];
      source_urls: string[];
      evidence: string[];
      unavailable_sources: string[];
    }
  | {
      state: "ERROR";
      error:
        | "INVALID_IMAGE"
        | "API_UNAVAILABLE"
        | "PROCESSING_FAILED"
        | "UNSUPPORTED_INPUT";
    };
