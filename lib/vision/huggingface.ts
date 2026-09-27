import type { VisionDetection } from "../candidates/extract";
import { ProviderError } from "../errors";

export interface VisionAdapter { detect(image: Buffer): Promise<VisionDetection>; }
type VisionLogger = (event: string, details: Record<string, unknown>) => void;
type ChatResponse = { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
const MODEL = process.env.HF_VISION_MODEL ?? "Qwen/Qwen2.5-VL-3B-Instruct";
const ENDPOINT = "https://router.huggingface.co/v1/chat/completions";
const VISION_TIMEOUT_MS = 30_000;

function parseDetection(raw: string): VisionDetection {
  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i)?.[1];
  const object = fenced ?? raw.match(/\{[\s\S]*\}/)?.[0];
  if (!object) throw new ProviderError("vision", "INVALID_RESPONSE", "Vision response did not contain JSON.");
  try {
    const parsed = JSON.parse(object) as { candidates?: Array<{ text?: unknown }>; artist?: unknown; title?: unknown; year?: unknown; medium?: unknown };
    const stringOrNull = (value: unknown): string | null =>
      typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    const extracted = {
      artist: stringOrNull(parsed.artist),
      title: stringOrNull(parsed.title),
      year: stringOrNull(parsed.year),
      medium: stringOrNull(parsed.medium)
    };
    const values = [
      ...(Array.isArray(parsed.candidates) ? parsed.candidates.map(item => item?.text) : []),
      extracted.artist,
      extracted.title,
      extracted.year,
      extracted.medium
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return {
      extracted,
      webDetection: {
        webEntities: [...new Set(values)].map(description => ({ description })),
        bestGuessLabels: []
      }
    };
  } catch { throw new ProviderError("vision", "INVALID_RESPONSE", "Vision response JSON was invalid."); }
}

export class HuggingFaceVisionAdapter implements VisionAdapter {
  constructor(
    private readonly token = process.env.HF_TOKEN,
    private readonly log: VisionLogger = (event, details) => console.info("[ekphrasis]", event, details)
  ) {}

  async detect(image: Buffer): Promise<VisionDetection> {
    if (!this.token) throw new ProviderError("vision", "AUTH", "Hugging Face token is not configured.");
    const startedAt = Date.now();
    this.log("vision.start", { model: MODEL, bytes: image.byteLength, timeoutMs: VISION_TIMEOUT_MS });
    const body = { model: MODEL, messages: [{ role: "user", content: [
      { type: "text", text: "Identify this artwork for museum catalog search. Return ONLY JSON with keys artist, title, year, medium, candidates. Use null when unknown. candidates must be an array of up to 8 distinctive search phrases, including visible title/artist text and likely artwork identifiers. Do not invent exact metadata when uncertain." },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64," + image.toString("base64") } }
    ] }], temperature: 0, max_tokens: 300 };
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(VISION_TIMEOUT_MS) });
      this.log("vision.response", { status: response.status, elapsedMs: Date.now() - startedAt });
      if (response.status === 401 || response.status === 403) throw new ProviderError("vision", "AUTH", "Hugging Face authentication failed.");
      if (response.status === 429) throw new ProviderError("vision", "RATE_LIMITED", "Hugging Face rate limit reached.");
      if (!response.ok) throw new ProviderError("vision", "PROVIDER_ERROR", "Hugging Face vision request failed.");
      const payload = await response.json() as ChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map(part => part.text ?? "").join("") : "";
      const result = parseDetection(text);
      this.log("vision.success", { elapsedMs: Date.now() - startedAt, candidates: result.webDetection?.webEntities?.length ?? 0 });
      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (error instanceof ProviderError) {
        this.log("vision.error", { failure: error.failure, elapsedMs });
        throw error;
      }
      if (error instanceof DOMException && error.name === "TimeoutError") {
        this.log("vision.error", { failure: "TIMEOUT", elapsedMs });
        throw new ProviderError("vision", "TIMEOUT", "Hugging Face vision request timed out.");
      }
      this.log("vision.error", { failure: "NETWORK", elapsedMs });
      throw new ProviderError("vision", "NETWORK", "Hugging Face vision request failed.");
    }
  }
}
