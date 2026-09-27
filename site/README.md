# Ekphrasis GitHub Pages Dashboard

This directory is the public, static architecture demo for Ekphrasis.

## Fixture mode

The dashboard imports `data/demo-run.js` and renders a deterministic identification run. It does not call Hugging Face Vision, museum APIs, Qdrant, Wikidata, or Wikipedia for data. The only remote resources are the explicitly displayed artwork image and source links used to demonstrate museum provenance.

The fixture intentionally shows:
- four primary museum adapters running in parallel;
- one degraded provider;
- `MATCH`, `MISMATCH`, and `UNAVAILABLE` evidence semantics;
- deterministic canonical-source selection;
- a conditional CLIP + Qdrant fallback;
- museum-sourced artwork provenance;
- The Match / The Context / The Detail presentation model.

## Future API mode

The planned backend is `POST /api/identify`. The dashboard should eventually replace the fixture import with a small adapter that maps the backend's `IdentificationResult` to the same rendering contract. The presentation layer should not know provider-specific API response shapes.

## Local preview

Serve this directory with any static HTTP server, for example:

    python3 -m http.server 4173 --directory site

Then open `http://localhost:4173`.

GitHub Pages deploys this directory directly; no Node runtime or build step is required.
Repository deployment target: `silascroe/ekphrasis-repair`.

