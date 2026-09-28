# Codex Vision Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace Ekphrasis's failing Hugging Face vision/candidate-generation stage with an authenticated droplet-hosted Python service that invokes Codex on the uploaded artwork while preserving useful filename/metadata clues and leaving the existing museum verification pipeline intact.

**Architecture:** The browser extracts safe upload context before image normalization, then Vercel sends the normalized image plus that context to a new `CodexVisionAdapter`. That adapter calls a narrow FastAPI service on the existing droplet; the service runs `codex --search exec` with the image and strict output schema, returns candidate JSON, and the existing TypeScript museum/scoring/enrichment pipeline continues unchanged.

**Tech Stack:** Next.js 15, TypeScript 5.9, Vitest, `exifr`, Python 3.12, FastAPI, Pydantic, Uvicorn, pytest, Codex CLI 0.155.1+, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-27-codex-vision-bridge-design.md`

## Global Constraints

- Replace only the vision/candidate-generation stage; do not migrate museum search, scoring, enrichment, caching, or presentation to Python.
- Preserve original filename plus whitelisted metadata before client image resizing/re-encoding.
- Never forward GPS, device identifiers, capture timestamps, camera make/model, or raw metadata objects.
- The droplet exposes only `POST /v1/identify`; there is no generic prompt/shell/Codex endpoint.
- User-controlled strings are never interpolated into a shell command.
- Codex uses live web search, image input, strict output schema, ephemeral sessions, and the CLI's read-only sandbox. The bridge secret is not passed to the Codex child process.
- Initial Codex concurrency is 1.
- `CODEX_TIMEOUT_SECONDS` defaults to 240; Vercel `POST /api/identify` declares `maxDuration = 300`.
- Codex confidence is diagnostic only; existing museum evidence remains authoritative.
- Hugging Face code remains available for rollback during the first rollout.
- Uploaded droplet files are temporary and are always deleted.
- Existing Remote Desktop Commander permissions are not widened.

## Review Focus

- A filename containing an artwork title must survive image compression as context, without becoming a filesystem path on the droplet.
- EXIF/XMP containing GPS, capture time, camera/device fields, or unknown tags must not be forwarded.
- A large HEIC/JPEG that is re-encoded must still carry its original filename/metadata context to the vision adapter.
- A slow or malformed Codex run must time out/fail cleanly without leaking a temp file or producing a guessed match.
- A correct Codex identification absent from the connected museum catalogs must remain a `NO_MATCH` in v1 rather than bypassing the existing evidence gate.

---

### Task 1: Capture and transport safe upload context

**Files:**
- Create: `lib/image/upload-context.ts`
- Create: `lib/image/metadata.ts`
- Modify: `components/upload-form.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/frontend/upload-context.test.ts`
- Modify test: `tests/frontend/upload-preparation.test.ts`

**Interfaces:**
- Produces: `UploadContext`, `extractUploadContext(file: File): Promise<UploadContext>`, `canonicalUploadContext(context?: UploadContext): string`.
- Consumes: browser `File`; best-effort `exifr` parsing.

- [x] **Step 1: Write failing upload-context tests**

Add tests asserting:
- `extractUploadContext()` preserves `originalFilename`, `originalMimeType`, and `originalSize`;
- only title/description/artist/copyright/subject/documentName/comment are retained from parser output;
- GPS, timestamps, camera make/model, serial/owner fields, and unknown fields are absent;
- parser failure returns the basic filename/type/size context rather than throwing;
- `canonicalUploadContext()` is deterministic and excludes `originalSize` from the identity string.

Run: `npm test -- tests/frontend/upload-context.test.ts`
Expected: FAIL because the module/functions do not exist.

- [x] **Step 2: Add `exifr` and implement upload-context extraction**

Create:
```ts
export type UploadContext = {
  originalFilename: string;
  originalMimeType: string | null;
  originalSize: number;
  embedded?: {
    title?: string;
    description?: string;
    artist?: string;
    copyright?: string;
    subject?: string;
    documentName?: string;
    comment?: string;
  };
};

export async function extractUploadContext(file: File): Promise<UploadContext>;
export function canonicalUploadContext(context?: UploadContext): string;
```

Use explicit metadata tag selection; metadata parsing is best-effort and non-blocking.

Run: `npm test -- tests/frontend/upload-context.test.ts`
Expected: PASS.

- [x] **Step 3: Send context before normalization destroys metadata**

In `UploadForm.submit(file)`, call `extractUploadContext(file)` before `prepareUploadFile(file)`. Append:
- `image`: prepared file;
- `context`: JSON string of `UploadContext`.

Extend the existing upload-preparation test to prove a large `painting.heic` can become `painting.jpg` while its separately captured context still reports the original filename `painting.heic`.

Run: `npm test -- tests/frontend/upload-preparation.test.ts tests/frontend/upload-context.test.ts`
Expected: PASS.

- [x] **Step 4: Commit Task 1**

Commit message: `feat: preserve upload identification context`.

---

### Task 2: Thread context through the provider-independent pipeline and cache key

**Files:**
- Create: `lib/vision/types.ts`
- Modify: `lib/vision/huggingface.ts`
- Modify: `lib/pipeline/identify.ts`
- Modify: `app/api/identify/route.ts`
- Test: `tests/unit/pipeline/upload-context.test.ts`
- Modify test: `tests/api/identify.test.ts`

**Interfaces:**
- Consumes: `UploadContext` from Task 1.
- Produces:
```ts
export type VisionInput = { image: Buffer; context?: UploadContext };
export interface VisionAdapter { detect(input: VisionInput): Promise<VisionDetection>; }
```
- Existing Hugging Face behavior remains compatible by ignoring `context`.

- [x] **Step 1: Write failing pipeline/context tests**

Assert:
- `identifyImage()` passes normalized bytes and request context to `vision.detect()`;
- identical image bytes with different canonical filename/embedded clues produce different cache hashes;
- changing only `originalSize` does not change the cache identity;
- malformed `context` JSON at `POST /api/identify` returns 400 rather than reaching providers;
- a Codex candidate that has no matching museum result still produces the existing `NO_MATCH` behavior rather than bypassing the evidence gate.

Run: `npm test -- tests/unit/pipeline/upload-context.test.ts tests/api/identify.test.ts`
Expected: FAIL.

- [x] **Step 2: Extract the vision interface and update adapters**

Move `VisionAdapter` out of `huggingface.ts` into `lib/vision/types.ts`. Change `HuggingFaceVisionAdapter.detect` to accept `VisionInput` and use only `input.image`.

Run: `npm run typecheck`
Expected: initial downstream type errors identify every call site that must be updated.

- [x] **Step 3: Parse context at the API boundary and make caching context-sensitive**

Extend `IdentifyRequest` with `context?: UploadContext`. Parse/validate the `context` form field conservatively in the route. Derive cache identity from image bytes plus `canonicalUploadContext(context)`; keep `originalSize` diagnostic-only.

Run: `npm test -- tests/unit/pipeline/upload-context.test.ts tests/api/identify.test.ts`
Expected: PASS.

- [x] **Step 4: Run regression tests and commit Task 2**

Run: `npm test && npm run typecheck`
Expected: PASS.

Commit message: `refactor: pass upload context through vision pipeline`.

---

### Task 3: Add the Vercel-side Codex vision adapter

**Files:**
- Create: `lib/vision/codex.ts`
- Create: `tests/adapters/codex-vision.test.ts`
- Modify: `app/api/identify/route.ts`
- Modify: `README.md` or existing environment/config documentation

**Interfaces:**
- Consumes: `VisionInput`.
- Produces: existing `VisionDetection`.
- Configuration:
  - `EKPHRASIS_AGENT_URL`
  - `EKPHRASIS_AGENT_SECRET`
  - optional `EKPHRASIS_AGENT_TIMEOUT_MS`, default 260000.

- [x] **Step 1: Write failing adapter tests**

Mock `fetch` and assert:
- request URL is `<agent-url>/v1/identify`;
- bearer secret is sent only in the Authorization header;
- normalized image is base64 encoded;
- filename/metadata context is sent as structured JSON;
- a valid bridge response maps to the same `VisionDetection` shape the museum pipeline already consumes;
- 401/403 → `AUTH`;
- 429 → `RATE_LIMITED`;
- timeout → `TIMEOUT`;
- invalid/non-JSON response and 5xx → `PROVIDER_ERROR`.

Run: `npm test -- tests/adapters/codex-vision.test.ts`
Expected: FAIL.

- [x] **Step 2: Implement `CodexVisionAdapter`**

Create:
```ts
export class CodexVisionAdapter implements VisionAdapter {
  constructor(
    endpoint?: string,
    secret?: string,
    fetcher?: typeof fetch,
    timeoutMs?: number
  );
  detect(input: VisionInput): Promise<VisionDetection>;
}
```

Bound provider error text before logging. Do not log image contents or secret values.

Run: `npm test -- tests/adapters/codex-vision.test.ts`
Expected: PASS.

- [x] **Step 3: Select Codex in production without deleting HF**

In the route, instantiate `CodexVisionAdapter` when both `EKPHRASIS_AGENT_URL` and `EKPHRASIS_AGENT_SECRET` are set; otherwise retain the HF adapter for rollback/dev compatibility.

Add `export const maxDuration = 300`.

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [x] **Step 4: Commit Task 3**

Commit message: `feat: add Codex vision provider`.

---

### Task 4: Build the narrow Python/Codex bridge service

**Files:**
- Create: `services/codex-vision/pyproject.toml`
- Create: `services/codex-vision/app/__init__.py`
- Create: `services/codex-vision/app/models.py`
- Create: `services/codex-vision/app/prompt.py`
- Create: `services/codex-vision/app/codex_runner.py`
- Create: `services/codex-vision/app/main.py`
- Create: `services/codex-vision/artwork-identification.schema.json`
- Create: `services/codex-vision/tests/test_api.py`
- Create: `services/codex-vision/tests/test_runner.py`

**Interfaces:**
- HTTP: authenticated `POST /v1/identify`.
- Runner:
```python
async def identify_with_codex(request: IdentifyRequest, settings: Settings) -> IdentifyResponse
```
- Codex invocation is an argv list; no shell interpolation.

- [x] **Step 1: Write failing service API/model tests**

Tests cover:
- missing/wrong bearer secret → 401;
- unsupported MIME → 400;
- oversized decoded image → 413;
- unknown context fields are rejected with 400 by strict request validation;
- one active request plus a second concurrent request produces the configured busy/retryable behavior;
- valid mocked runner response → 200 exact schema.

Run from `services/codex-vision`: `python -m pytest tests/test_api.py -q`
Expected: FAIL before service modules exist.

- [x] **Step 2: Implement Pydantic request/response models and FastAPI boundary**

Implement strict models for version 1, image MIME/base64, safe context, candidate output, source URLs, confidence, and evidence.

Use `hmac.compare_digest` for the bearer value. Configure strict Pydantic models (`extra="forbid"`) and map request-validation failures to HTTP 400. Decode into a generated temporary directory and generated filename.

Run: `python -m pytest tests/test_api.py -q`
Expected: API/model tests PASS with runner mocked.

- [x] **Step 3: Write failing Codex runner tests**

Mock the async subprocess layer and assert the argv includes:
- `codex`;
- `--search`;
- `exec`;
- `--image <generated-path>`;
- `--output-schema <schema-path>`;
- `--ephemeral`;
- `--sandbox read-only`;
- `--skip-git-repo-check`;
- output-last-message file;
- configured model/profile flags when present.

Assert:
- prompt contains safe filename/metadata clues;
- the original user filename appears only in prompt/context and is never used as the generated filesystem path;
- prompt explicitly stops after minimal authoritative verification for obvious/directly corroborated identities;
- timeout kills the subprocess and maps to a timeout error;
- timeout/cancellation terminates the Codex process group so tool descendants do not outlive the request;
- invalid output JSON/schema maps to provider failure;
- temp directory is gone after success, invalid output, and timeout.

Run: `python -m pytest tests/test_runner.py -q`
Expected: FAIL.

- [x] **Step 4: Implement the runner**

Use `asyncio.create_subprocess_exec`, never `shell=True`. Use a process-level `asyncio.Semaphore(1)`.

Settings:
- `EKPHRASIS_AGENT_SECRET` required;
- `CODEX_BIN=codex`;
- `CODEX_TIMEOUT_SECONDS=240`;
- optional `CODEX_MODEL`;
- optional `CODEX_PROFILE`.

The prompt should first exploit direct clues and stop once an exact identity has sufficient authoritative corroboration; only broaden research when identity is genuinely uncertain.

Run: `python -m pytest -q`
Expected: PASS.

- [x] **Step 5: Commit Task 4**

Commit message: `feat: add Codex vision bridge service`.

---

### Task 5: Add CI and deployment artifacts without touching production secrets

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `services/codex-vision/README.md`
- Create: `services/codex-vision/deploy/ekphrasis-codex-vision.service`
- Create: `services/codex-vision/deploy/Caddyfile.example`
- Create: `services/codex-vision/deploy/codex-config.toml.example`
- Create: `services/codex-vision/.env.example`

**Interfaces:**
- CI must run both TypeScript and Python test suites.
- Deployment templates contain placeholders only; never commit the real bearer secret or Codex credentials.

- [x] **Step 1: Extend CI**

Add Python 3.12 setup and install/test `services/codex-vision` after the existing Node checks.

Run locally/CI-equivalent:
- `npm test`
- `npm run typecheck`
- `npm run build`
- `cd services/codex-vision && python -m pytest -q`

Expected: all PASS.

- [x] **Step 2: Add deployment documentation/templates**

Document:
- existing authenticated `domainpatrol` account and Codex profile, with a separate bridge systemd unit and Python environment;
- FastAPI bound to localhost only;
- Caddy HTTPS reverse proxy;
- required environment variables;
- generating one high-entropy shared secret;
- adding `EKPHRASIS_AGENT_URL` and `EKPHRASIS_AGENT_SECRET` to Vercel;
- health/smoke commands;
- rollback by unsetting Codex bridge vars to return to HF.

The systemd template runs Uvicorn from the service virtualenv and restarts on failure.

- [x] **Step 3: Commit Task 5**

Commit message: `chore: add Codex bridge CI and deployment runbook`.

---

### Task 6: Deploy and perform live end-to-end verification

**Files:** no repository changes required unless deployment reveals a defect.

**Interfaces:**
- Requires root/operator access on `first-droplet` that the restricted Remote Desktop Commander account intentionally does not have.
- Uses the existing authenticated `domainpatrol` account and `/opt/domainpatrol/.codex`, per the user's deployment choice; keep the bridge's service unit, virtualenv, and temporary work directory separate from the Discord bot.
- Requires Vercel environment writes.

- [x] **Step 1: Install the service on the droplet with privileged/operator Codex**

Install the virtualenv, service directory, systemd unit, and HTTPS proxy under `/opt/domainpatrol/ekphrasis-repair`, using the existing `domainpatrol` account. Do not widen the `chatgpt` Remote Desktop Commander sandbox.

Expected: `GET /health` over HTTPS returns healthy without authentication-sensitive data. Verified on 2026-09-27 at `https://ekphrasisrepair.157.230.209.169.nip.io/health`; Caddy forwards only `/health` and `/v1/identify` to localhost.

- [x] **Step 2: Verify the existing account's Codex automation**

As the service account, verify:
- `codex --version`;
- ChatGPT authentication;
- `codex --search exec --image ... --output-schema ... --ephemeral --sandbox read-only` succeeds on a test image.

Expected: valid strict JSON output. Verified on 2026-09-27 through the authenticated HTTPS endpoint using a public-domain Met image: Codex returned Vincent van Gogh, *Madame Roulin and Her Baby* (1888), with a Met source URL. The initial request exposed unsupported JSON Schema `format: uri`; the schema now uses an HTTPS URL pattern and the bridge's Pydantic response model continues to validate URLs.

- [x] **Step 3: Set Vercel Preview bridge environment variables and redeploy**

The user set `EKPHRASIS_AGENT_URL` and `EKPHRASIS_AGENT_SECRET` for the feature-branch Preview only. A no-content commit (`b07dd596a08e3bac6d71feae7a5d5b94e9f598a8`) triggered a fresh GitHub-connected Vercel deployment, READY at `https://ekphrasis-repair-nfc3bud06-clankclub.vercel.app` (`dpl_DoQA2DXRA3nkSckp4Lyp572gkfEs`). Production remains on `main` and was not changed.

The Preview page and API route are reachable. Successful `NO_MATCH` responses show the API completed, but this smoke alone does not independently prove which vision adapter was selected.

- [ ] **Step 4: Run live artwork smoke tests**

Test:
- a famous obvious artwork;
- a moderately obscure museum work;
- `Minerva verandert Perdix in een vogel`;
- Fernand Cormon's `Bacchanale de nymphes et de satyres`;
- one cropped/edited image.

Partial live smoke test on 2026-09-28: the Met control image and user-provided Cormon image `2-129302.jpg` (with filename/type/size context) each returned HTTP 200 `NO_MATCH`, `degraded: true`, and unavailable sources `met`, `rijksmuseum`, `smithsonian`. The Vercel page returns 200. Vercel runtime logs also report missing optional Upstash Redis URL/token. These results do not count as successful artwork matches; the remaining image cases and interactive result view are still pending.

Record whether each is correct, honest no-match/uncertain, or confidently wrong.

Expected: no provider 503s, no leaked temp files, obvious works complete materially faster than the hard-case timeout, and difficult works either identify or fail honestly.

- [ ] **Step 5: Commit any deployment-discovered fixes separately**

Only if verification exposes a defect. Re-run both TypeScript and Python suites before committing.
