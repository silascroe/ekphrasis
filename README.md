# Ekphrasis

Ekphrasis is a web service for identifying paintings from photographs — effectively “Shazam for paintings.”

## MVP architecture

`Image Intake → SHA-256 Cache → Hugging Face Vision → Candidate Extraction → parallel Museum Search → Matching/Scoring → CLIP/Qdrant fallback → Enrichment → Presentation`

Primary museum sources:
- The Metropolitan Museum of Art
- Rijksmuseum
- Art Institute of Chicago
- Smithsonian Open Access

The implementation is a Next.js App Router application intended for Vercel. User images are ephemeral and are never stored as image assets. Railway is not part of the architecture.

The written architecture documents under `docs/superpowers/` describe the original design and may contain historical Google Vision references from before the runtime migrated to Hugging Face.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `HF_TOKEN` and a separate `RATE_LIMIT_HMAC_SECRET` before exercising `/api/identify`.
3. Add museum, Upstash, Qdrant, and CLIP credentials only for the integrations you intend to exercise.
4. Install dependencies with `npm install`.
5. Start the app with `npm run dev`.
6. Run verification with `npm test`, `npm run typecheck`, and `npm run build`.

The Met and Art Institute adapters do not require API keys. Rijksmuseum and Smithsonian configuration remains environment-driven in the current runtime.

## API

`POST /api/identify` accepts a multipart form field named `image`.

Public states are:
- `MATCH`
- `NO_MATCH`
- `ERROR`

Repeated identical uploads use a SHA-256 result cache. Normal results use a 7-day TTL; degraded results use a 15-minute TTL. `API_UNAVAILABLE` is not cached as a normal result.

Anonymous requests are rate-limited before recognition starts. The MVP uses 5 requests/minute and 30 requests/hour per privacy-preserving identity key.

## Known incomplete integrations

- The Rijksmuseum adapter still uses the legacy key-based collection API and needs migration to the current no-key Data Services / Linked Art workflow.
- CLIP/Qdrant runtime plumbing exists, but the repository does not yet contain the promised corpus export, embedding/index build, validation, and promotion workflow.
- Live Hugging Face, Redis, museum-key, and Qdrant paths still require environment-specific verification.

## Dashboard

The GitHub Pages dashboard is fixture-driven documentation of the recognition architecture. It does not contain provider credentials and does not perform live identification.

Dashboard: https://lethephos.github.io/ekphrasis/
