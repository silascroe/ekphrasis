export type ExtractedArtwork = {
  artist?: string | null;
  title?: string | null;
  year?: string | null;
  medium?: string | null;
};

export type VisionDetection = {
  extracted?: ExtractedArtwork;
  webDetection?: {
    webEntities?: Array<{ description?: string | null }>;
    bestGuessLabels?: Array<{ label?: string | null }>;
  };
};

export function extractSearchCandidates(detection: VisionDetection): string[] {
  const extracted = detection.extracted ?? {};
  const values = [
    ...(detection.webDetection?.webEntities ?? []).map(item => item.description),
    ...(detection.webDetection?.bestGuessLabels ?? []).map(item => item.label),
    extracted.artist,
    extracted.title,
    extracted.year,
    extracted.medium
  ];
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).values())].slice(0, 12);
}
