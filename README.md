# Ekphrasis

Ekphrasis identifies paintings from photographs—“Shazam for paintings.” This repository is the active repair and integration build of the project.

## Project links

- Repository: https://github.com/silascroe/ekphrasis-repair
- Current Codex vision bridge work: [PR #7](https://github.com/silascroe/ekphrasis-repair/pull/7)
- Approved bridge design: [PR #6](https://github.com/silascroe/ekphrasis-repair/pull/6)
- Architecture dashboard: https://lethephos.github.io/ekphrasis/
- Vercel project: https://vercel.com/clankclub/ekphrasis-repair

## Current architecture

`Image upload → normalization and context capture → cache → vision provider → candidate extraction → parallel museum search → evidence-based matching → optional CLIP/Qdrant fallback → enrichment → result`

The app is a Next.js App Router application deployed through Vercel. The vision provider is selected at the TypeScript provider boundary. When both `EKPHRASIS_AGENT_URL` and `EKPHRASIS_AGENT_SECRET` are configured, the app calls the authenticated Python/Codex service. If either is absent, the Hugging Face adapter remains available for development and rollback.

The Python bridge generates artwork candidates only. Museum search, matching/scoring, cache behavior, enrichment, and presentation stay in the existing TypeScript application. A Codex candidate does not become a public match without the existing museum evidence checks.

Primary museum sources are The Metropolitan Museum of Art, Rijksmuseum, Art Institute of Chicago, and Smithsonian Open Access.

## Bridge rollout status

Status as of 2026-09-27: implementation is on the open, review-ready [PR #7](https://github.com/silascroe/ekphrasis-repair/pull/7). The bridge, tests, CI integration, and deployment templates are in the branch. The service has not been installed on the Droplet, Codex has not been authenticated for a dedicated service account, no bridge secret or Vercel bridge variables have been configured, and live end-to-end artwork tests remain pending. A ready Vercel preview is not evidence that the Droplet bridge is live.

See [the bridge design](docs/superpowers/specs/2026-09-27-codex-vision-bridge-design.md), [the implementation plan](docs/superpowers/plans/2026-09-27-codex-vision-bridge.md), and [the Python service runbook](services/codex-vision/README.md). Deployment is the plan’s remaining Task 6.

## Upload privacy and request behavior

The browser captures the original filename and a small explicit whitelist of embedded artwork clues before image normalization. Only the normalized image and this safe context reach the vision service. GPS, capture timestamps, camera/device identifiers, owner fields, and arbitrary raw metadata are excluded. Images are processed ephemerally and are not kept as image assets.

The bridge accepts one authenticated `POST /v1/identify` request, invokes Codex with image input, web search, a strict output schema, an ephemeral session, and a read-only sandbox, then removes its temporary files. The bridge secret is not passed to the Codex subprocess. The initial Codex concurrency limit is one.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `RATE_LIMIT_HMAC_SECRET` before exercising `/api/identify`.
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev`.
5. Verify changes with:

```sh
npm test
npm run typecheck
npm run build
```

Python bridge tests run from `services/codex-vision`:

```sh
python -m pip install -e '.[test]'
python -m pytest -q
```

Museum and infrastructure credentials are environment-specific. Tests use provider mocks and should not need production credentials.

## Known follow-up work

- Complete and verify the Droplet installation, Codex authentication, HTTPS endpoint, and Vercel environment configuration under the approved deployment plan.
- Migrate the Rijksmuseum adapter from the legacy key-based API to the current Data Services / Linked Art workflow.
- Build the missing CLIP/Qdrant corpus export, embedding/index build, validation, and promotion workflow.
- Verify live Hugging Face, Redis, museum-key, and Qdrant paths in their target environments.
- Run the planned live artwork smoke tests, including obvious, obscure, cropped, Dutch-title, and Fernand Cormon cases.

The architecture dashboard is fixture-driven documentation; it has no provider credentials and does not perform live identification.
