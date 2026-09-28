import type { VisionDetection } from "../candidates/extract";
import { ProviderError } from "../errors";
import type { VisionAdapter, VisionInput } from "./types";

const DEFAULT_TIMEOUT_MS = 260_000;
const MAX_RESPONSE_CHARS = 64 * 1024;
const MAX_CANDIDATES = 8;
const MAX_DIAGNOSTIC_ITEMS = 8;

type BridgeResponse = {
  artist: string | null;
  title: string | null;
  year: string | null;
  medium: string | null;
  candidates: Array<{ text: string }>;
  confidence: "high" | "medium" | "low";
  source_urls: string[];
  evidence: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error("Invalid bridge response string.");
  }
  return value.trim();
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error("Invalid bridge response list.");
  return value.map(item => {
    const result = boundedString(item, maxLength);
    if (!result) throw new Error("Invalid bridge response list item.");
    return result;
  });
}

function parseBridgeResponse(value: unknown): BridgeResponse {
  const keys = ["artist", "title", "year", "medium", "candidates", "confidence", "source_urls", "evidence"];
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) {
    throw new Error("Invalid bridge response shape.");
  }

  const confidence = value.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    throw new Error("Invalid bridge confidence.");
  }
  if (!Array.isArray(value.candidates) || value.candidates.length > MAX_CANDIDATES) {
    throw new Error("Invalid bridge candidates.");
  }

  const candidates = value.candidates.map(item => {
    if (!isRecord(item) || Object.keys(item).some(key => key !== "text") || typeof item.text !== "string") {
      throw new Error("Invalid bridge candidate.");
    }
    const text = boundedString(item.text, 1000);
    if (!text) throw new Error("Invalid bridge candidate.");
    return { text };
  });

  const sourceUrls = stringList(value.source_urls, MAX_DIAGNOSTIC_ITEMS, 2048);
  for (const source of sourceUrls) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error("Invalid bridge source URL.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Invalid bridge source URL.");
    }
  }

  return {
    artist: boundedString(value.artist, 1000),
    title: boundedString(value.title, 1000),
    year: boundedString(value.year, 100),
    medium: boundedString(value.medium, 1000),
    candidates,
    confidence,
    source_urls: sourceUrls,
    evidence: stringList(value.evidence, MAX_DIAGNOSTIC_ITEMS, 2000)
  };
}

function toDetection(result: BridgeResponse): VisionDetection {
  const extracted = {
    artist: result.artist,
    title: result.title,
    year: result.year,
    medium: result.medium
  };
  const values = [
    ...result.candidates.map(candidate => candidate.text),
    extracted.artist,
    extracted.title,
    extracted.year,
    extracted.medium
  ].filter((value): value is string => Boolean(value?.trim()));

  return {
    extracted,
    research: {
      confidence: result.confidence,
      sourceUrls: result.source_urls,
      evidence: result.evidence
    },
    webDetection: {
      webEntities: [...new Set(values)].map(description => ({ description })),
      bestGuessLabels: []
    }
  };
}

function endpointUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ProviderError("vision", "AUTH", "Codex vision bridge URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new ProviderError("vision", "AUTH", "Codex vision bridge must use a valid HTTPS URL.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/v1/identify") ? pathname : `${pathname}/v1/identify`;
  return url.toString();
}

function safeLog(failure: string, details: Record<string, unknown> = {}): void {
  console.info("vision_provider_failure", { provider: "codex-bridge", failure, ...details });
}

function providerFailure(
  failureClass: ConstructorParameters<typeof ProviderError>[1],
  message: string
): ProviderError {
  return new ProviderError("vision", failureClass, message);
}

export class CodexVisionAdapter implements VisionAdapter {
  private readonly endpoint: string | undefined;
  private readonly secret: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    endpoint = process.env.EKPHRASIS_AGENT_URL,
    secret = process.env.EKPHRASIS_AGENT_SECRET,
    fetcher: typeof fetch = fetch,
    timeoutMs = Number(process.env.EKPHRASIS_AGENT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  ) {
    this.endpoint = endpoint?.trim() || undefined;
    this.secret = secret?.trim() || undefined;
    this.fetcher = fetcher;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  async detect(input: VisionInput): Promise<VisionDetection> {
    if (!this.endpoint || !this.secret) {
      throw providerFailure("AUTH", "Codex vision bridge is not configured.");
    }

    const url = endpointUrl(this.endpoint);
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = {
      version: 1,
      request_id: crypto.randomUUID(),
      image: {
        mime_type: "image/jpeg",
        base64: input.image.toString("base64")
      },
      context: input.context ? {
        original_filename: input.context.originalFilename,
        original_mime_type: input.context.originalMimeType,
        original_size: input.context.originalSize,
        ...(input.context.embedded ? {
          embedded: {
            title: input.context.embedded.title,
            description: input.context.embedded.description,
            artist: input.context.embedded.artist,
            copyright: input.context.embedded.copyright,
            subject: input.context.embedded.subject,
            document_name: input.context.embedded.documentName,
            comment: input.context.embedded.comment
          }
        } : {})
      } : null
    };

    try {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.secret}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        const errorName = error && typeof error === "object" && "name" in error
          ? String((error as { name?: unknown }).name)
          : "";
        if (controller.signal.aborted || ["AbortError", "TimeoutError"].includes(errorName)) {
          safeLog("TIMEOUT", { elapsed_ms: Date.now() - startedAt });
          throw providerFailure("TIMEOUT", "Codex vision bridge request timed out.");
        }
        safeLog("NETWORK", { elapsed_ms: Date.now() - startedAt });
        throw providerFailure("NETWORK", "Codex vision bridge could not be reached.");
      }

      if (response.status === 401 || response.status === 403) {
        safeLog("AUTH", { status: response.status, elapsed_ms: Date.now() - startedAt });
        throw providerFailure("AUTH", "Codex vision bridge rejected authentication.");
      }
      if (response.status === 429) {
        safeLog("RATE_LIMITED", { status: response.status, elapsed_ms: Date.now() - startedAt });
        throw providerFailure("RATE_LIMITED", "Codex vision bridge is busy.");
      }
      if (response.status === 504) {
        safeLog("TIMEOUT", { status: response.status, elapsed_ms: Date.now() - startedAt });
        throw providerFailure("TIMEOUT", "Codex vision bridge timed out.");
      }
      if (!response.ok) {
        safeLog("PROVIDER_ERROR", { status: response.status, elapsed_ms: Date.now() - startedAt });
        throw providerFailure("PROVIDER_ERROR", `Codex vision bridge returned HTTP ${response.status}.`);
      }

      let parsed: unknown;
      try {
        const raw = await response.text();
        if (raw.length > MAX_RESPONSE_CHARS) throw new Error("Bridge response exceeded size limit.");
        parsed = JSON.parse(raw) as unknown;
      } catch {
        if (controller.signal.aborted) {
          safeLog("TIMEOUT", { elapsed_ms: Date.now() - startedAt });
          throw providerFailure("TIMEOUT", "Codex vision bridge request timed out.");
        }
        safeLog("PROVIDER_ERROR", { status: response.status, elapsed_ms: Date.now() - startedAt });
        throw providerFailure("PROVIDER_ERROR", "Codex vision bridge returned an invalid response.");
      }

      try {
        const result = parseBridgeResponse(parsed);
        return toDetection(result);
      } catch {
        safeLog("PROVIDER_ERROR", { status: response.status, elapsed_ms: Date.now() - startedAt });
        throw providerFailure("PROVIDER_ERROR", "Codex vision bridge returned an invalid response.");
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
