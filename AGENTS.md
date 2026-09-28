# Repository agent guidance

## Read first

- Read `README.md` for project status and local commands.
- For bridge work, read the current design, implementation plan, and `services/codex-vision/README.md`.
- Treat current repository files and open PRs as the source of truth; verify deployment state before relying on it.

## Preserve the architecture

- Keep the Python bridge limited to image-based artwork candidate generation.
- Keep museum search, evidence gating, scoring, caching, enrichment, and presentation in the TypeScript app unless the user approves a separate design.
- Keep provider behavior behind the existing vision adapter contract.
- A Codex candidate or confidence value must not bypass museum evidence requirements.

## Protect user data and credentials

- Forward only the explicitly whitelisted upload context; never forward raw metadata, GPS, timestamps, or device identifiers.
- Use generated temporary filenames and remove temporary image/output files after every request.
- Never commit secrets, Codex authentication state, private artwork uploads, or populated production environment files.
- Do not log image contents, bearer secrets, or raw provider payloads.

## Verify and operate carefully

- Run `npm test`, `npm run typecheck`, and `npm run build` for TypeScript changes.
- Run `python -m pytest -q` from `services/codex-vision` for bridge changes.
- Do not treat a successful preview build as proof that the Droplet service or production bridge works.
- Do not merge the bridge PR, change production credentials/configuration, or expose a new service endpoint without the user's direction.
