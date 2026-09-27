# Codex Vision Bridge Design

Date: 2026-09-27

## 1. Goal

Replace only Ekphrasis's currently failing Hugging Face vision/candidate-generation stage with a small service on the existing DigitalOcean droplet that invokes Codex to identify an uploaded artwork.

Everything downstream in the existing Next.js pipeline remains in place for this version:

`upload → normalize → Codex vision bridge → candidate extraction → museum search → scoring/verification → CLIP fallback if configured → enrichment → result`

This design deliberately does **not** move museum adapters, scoring, enrichment, caching, or presentation to Python.

## 2. Why this boundary

The current app already has a useful provider boundary: the vision stage produces likely artist/title/year/medium/search candidates, and the TypeScript pipeline independently searches museum catalogs and applies deterministic evidence rules.

The missing piece is reliable candidate generation. Replacing the whole pipeline with an agent would discard working code and make it harder to tell which change improved identification.

The droplet therefore acts as an external vision/research provider, not as the new owner of Ekphrasis.

## 3. Change to the earlier architecture

The existing architecture document says the MVP must not depend on the external droplet. This design intentionally supersedes that constraint for the recognition stage.

For this version, successful recognition depends on the droplet service being reachable. If it is unavailable, Ekphrasis returns the same provider-unavailable class of error it returns for a failed vision provider.

This dependency can later be removed by adding another provider or fallback.

## 4. End-to-end flow

1. The browser receives the user's original `File`.
2. Before any resize/re-encode, the browser captures useful non-sensitive upload context.
3. Existing client image preparation runs as it does now.
4. `POST /api/identify` receives the prepared image plus upload context.
5. The existing image validation/normalization/cache boundary runs.
6. A new `CodexVisionAdapter` sends the normalized image and context to the droplet.
7. The droplet service validates/authenticates the request and creates an isolated temporary work directory.
8. The service writes the image using a generated filename, never the user-supplied filename as a path.
9. The service invokes Codex with a fixed artwork-identification prompt and a strict result schema.
10. Codex may use image inspection, the preserved filename/metadata clues, and web research.
11. The Python service validates Codex's output and returns structured candidate data.
12. The TypeScript adapter converts that response into the existing `VisionDetection` shape.
13. The existing museum search/scoring/enrichment pipeline continues unchanged.
14. Temporary files on the droplet are deleted in `finally` cleanup.

## 5. Upload context

The app should use helpful clues when they exist. Filename and metadata are not considered cheating; the product goal is identification.

Capture before `prepareUploadFile()`:

```ts
type UploadContext = {
  originalFilename: string;
  originalMimeType: string | null;
  originalSize: number;
  originalLastModified: number | null;
  embedded?: {
    title?: string;
    description?: string;
    artist?: string;
    copyright?: string;
    subject?: string;
    documentName?: string;
    comment?: string;
    software?: string;
  };
};
```

Embedded metadata extraction is best-effort and non-blocking. Failure to parse metadata must never reject an otherwise valid image.

Use a browser-capable metadata parser with explicit field selection. Do not forward the raw metadata object.

Never collect or forward GPS coordinates, device serial/identifier fields, camera owner names, or arbitrary location metadata.

## 6. Cache semantics

Because filename/embedded metadata can affect candidate generation, the vision cache key must become context-sensitive.

The cache key should be derived from:

- prepared/original upload bytes currently used by the server-side hash boundary; plus
- a deterministic serialization of the whitelisted identification context.

The serialization must exclude timestamps or fields that do not help identification if they would unnecessarily destroy cache reuse.

## 7. TypeScript vision boundary

Replace the byte-only interface with an explicit input object:

```ts
type VisionInput = {
  image: Buffer;
  context?: UploadContext;
};

interface VisionAdapter {
  detect(input: VisionInput): Promise<VisionDetection>;
}
```

The pipeline remains provider-independent.

The existing Hugging Face adapter may remain in the repository for rollback/testing, but production should instantiate `CodexVisionAdapter` when the droplet configuration is present.

## 8. Vercel-to-droplet request contract

Use one fixed authenticated endpoint:

`POST /v1/identify`

Request body: JSON, to make validation and authentication deterministic.

```json
{
  "version": 1,
  "request_id": "uuid",
  "image": {
    "mime_type": "image/jpeg",
    "base64": "..."
  },
  "context": {
    "original_filename": "example.jpg",
    "original_mime_type": "image/jpeg",
    "original_size": 123456,
    "embedded": {
      "title": "optional",
      "artist": "optional"
    }
  }
}
```

The client-prepared image is already bounded to roughly 4 MB, so base64 overhead is acceptable for this small service and avoids multipart-signing/path ambiguity.

Vercel configuration:

- `EKPHRASIS_AGENT_URL`
- `EKPHRASIS_AGENT_SECRET`

Authentication:

`Authorization: Bearer <EKPHRASIS_AGENT_SECRET>`

Use a high-entropy generated secret stored only in Vercel environment variables and the droplet service environment.

## 9. Droplet service

Implementation language: Python 3.12.

Recommended HTTP layer: FastAPI + Uvicorn.

The service exposes no generic shell, prompt, or Codex endpoint. The only public behavior is artwork identification.

Responsibilities:

- authenticate request;
- enforce body/image size limits;
- validate schema;
- reject unsupported image MIME types;
- create per-request temporary directory;
- write generated local image path;
- build the fixed Codex prompt;
- invoke Codex as a subprocess;
- enforce hard timeout;
- validate structured output with Pydantic;
- return JSON;
- remove temporary files regardless of success/failure;
- emit bounded diagnostic logs without image contents or secrets.

Run the service under a dedicated unprivileged service account rather than root.

The existing Remote Desktop Commander `chatgpt` account remains separate and restricted to `/home/chatgpt/workspace`; this design does not require widening its permissions.

## 10. Codex job

Codex is a reasoning/research component, not the workflow owner.

The fixed prompt should instruct it to:

- identify the specific artwork, not merely describe subject/style;
- use original filename and supplied safe metadata as legitimate clues;
- inspect visible signatures, labels, inscriptions, and composition;
- search authoritative museum/catalog sources first when web research is needed;
- broaden to reputable auction/catalogue/archive sources when museum records do not exist;
- avoid converting semantic resemblance into an exact identity;
- return uncertainty rather than inventing an exact artist/title;
- produce only the required structured result.

The service controls the model/reasoning profile via configuration. The intended initial profile is the user's Luna Max Codex configuration.

## 11. Codex response contract

Python validates this shape before returning it:

```json
{
  "artist": "string or null",
  "title": "string or null",
  "year": "string or null",
  "medium": "string or null",
  "candidates": [
    { "text": "distinctive search phrase" }
  ],
  "confidence": "high | medium | low",
  "source_urls": ["https://..."],
  "evidence": ["short evidence statement"]
}
```

Rules:

- maximum 8 candidate phrases;
- source URLs must be HTTP(S);
- invalid JSON/schema is a provider failure;
- confidence is diagnostic only and is **not** trusted as final Ekphrasis confidence;
- downstream museum evidence remains authoritative for museum-held works.

The TypeScript adapter maps `artist/title/year/medium/candidates` to the existing `VisionDetection` structure. The extra research fields may be logged or retained for diagnostics but do not bypass current matching rules.

## 12. Time budget

The current Vercel function architecture is synchronous. Vercel Functions have a finite execution duration, so Codex cannot be allowed to run indefinitely.

For version 1:

- Codex subprocess hard timeout: 180 seconds;
- droplet endpoint deadline: about 195 seconds;
- Vercel adapter timeout: about 205 seconds;
- leave the remaining function budget for museum search, scoring, enrichment, and response handling.

A timeout is a provider failure, not permission to guess.

If real usage shows that Luna Max regularly needs longer than this, the next architecture change should be an asynchronous job/status flow rather than simply increasing arbitrary timeouts.

## 13. Concurrency and quota protection

The droplet is currently a 1 vCPU / 1 GB DigitalOcean instance. Codex itself is remote inference, so the droplet does not need model-class hardware, but unrestricted subprocess concurrency would still be pointless and could burn the user's Codex allowance.

Version 1 should use a process-level semaphore with a concurrency limit of 1.

If a job is already active, either queue one bounded waiting request or return a busy/retryable response. Do not launch unlimited Codex sessions.

Existing Ekphrasis request rate limiting remains in front of the bridge.

## 14. Network exposure

The Python service must be reachable from Vercel over HTTPS.

Do not expose an unauthenticated raw Uvicorn port as the production interface.

Terminate TLS using a small reverse proxy such as Caddy, or an equivalent secure tunnel/proxy chosen during deployment. The service URL is configuration; the app must not hard-code the droplet IP or hostname.

IPv4 and IPv6 can both remain enabled. Nothing in the application contract depends on either one specifically.

## 15. Error mapping

Droplet response classes:

- `200`: valid candidate response;
- `400`: malformed/unsupported request;
- `401`: bad/missing bridge secret;
- `413`: image/body too large;
- `429`: local concurrency/rate guard;
- `502`: Codex returned invalid/unusable output;
- `504`: Codex timeout.

`CodexVisionAdapter` maps remote auth/config failures to vision `AUTH`, timeouts to `TIMEOUT`, retryable busy responses to `RATE_LIMITED`, and other remote failures to `PROVIDER_ERROR`.

The public `/api/identify` response behavior should remain compatible with the existing UI.

## 16. Logging and privacy

Log:

- generated request ID;
- image byte count and MIME type;
- whether filename metadata was present;
- Codex start/end/timeout;
- elapsed milliseconds;
- result confidence;
- candidate count;
- HTTP status/failure class.

Do not log:

- image base64;
- full uploaded image;
- authorization secret;
- raw EXIF/XMP object;
- user GPS/location metadata;
- full Codex transcript unless explicitly enabled for temporary debugging.

Uploaded image files on the droplet are ephemeral and deleted after each request.

## 17. Testing

TypeScript tests:

- original filename survives client preparation as context;
- safe metadata fields are selected;
- GPS/location fields are not forwarded;
- metadata parse failure does not block upload;
- context serialization is deterministic for cache keys;
- `CodexVisionAdapter` handles success, auth failure, invalid JSON, busy, and timeout;
- existing museum/search/scoring tests remain unchanged.

Python tests:

- auth required;
- payload/image size limits;
- invalid MIME rejected;
- Pydantic output validation;
- temp-file cleanup after success and failure;
- subprocess timeout;
- no user-controlled string is interpolated into a shell command;
- concurrency guard.

Integration test:

- mocked droplet endpoint returns candidate JSON;
- `POST /api/identify` continues through the existing museum pipeline.

Live smoke test after deployment:

- one well-known artwork;
- one moderately obscure artwork;
- the difficult Perdix print used during exploration;
- the Fernand Cormon auction work used during exploration;
- at least one cropped/edited image.

Track three outcome classes: correct identity, honest no-match/uncertain, confidently wrong.

## 18. Rollout

Do not delete the Hugging Face adapter in the first change.

Add the Codex adapter and configure production to use it. Keep the old adapter available for rollback until the new path has passed live smoke tests.

No museum adapter or matching logic is migrated to Python in this version.

No new repository is required. The Python service code can live under a clearly isolated directory in this repository (for example `services/codex-vision/`) until there is a concrete reason to split it out.

## 19. Future options intentionally deferred

Not part of this implementation:

- moving museum search/scoring to Python;
- moving final prose generation to Codex;
- Google Vision or reverse-image API fallback;
- asynchronous job architecture;
- multiple Codex workers;
- image-embedding/vector retrieval;
- persistent upload storage;
- user accounts/history.

Those become separate decisions only if actual usage justifies them.
