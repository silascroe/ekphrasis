# Ekphrasis Codex Vision Bridge

This service accepts one authenticated artwork-identification request at a time, runs Codex CLI with the normalized JPEG and safe upload clues, and returns a strict candidate response. The existing TypeScript pipeline still performs museum search and decides whether evidence is sufficient.

The service listens on localhost. Caddy provides HTTPS from Vercel to the Droplet. Remote Desktop Commander is only for manual administration; it is not part of the production request path.

## Local development

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[test]'
python -m pytest -q
uvicorn app.main:app --host 127.0.0.1 --port 8787
```

Set `EKPHRASIS_AGENT_SECRET` before starting the service. The tests use a mocked Codex runner and do not require Codex authentication.

## Droplet installation

The unit uses the existing `domainpatrol` Linux account and its authenticated Codex profile at `/opt/domainpatrol/.codex`, as chosen for this deployment. The bridge runs as a separate systemd service with its own Python environment and writable work directory; it does not share the Discord bridge's process or virtualenv. Keep the application tree root-owned and readable by `domainpatrol`; Codex should not be able to modify its own service code.

Create the writable bridge work directory:

```sh
sudo install -d -o root -g domainpatrol -m 0750 /opt/domainpatrol/ekphrasis-repair
sudo install -d -o domainpatrol -g domainpatrol -m 0700 /opt/domainpatrol/ekphrasis-repair/work
```

Install the service files into `/opt/domainpatrol/ekphrasis-repair`, then create its virtual environment:

```sh
sudo python3 -m venv /opt/domainpatrol/ekphrasis-repair/.venv
sudo /opt/domainpatrol/ekphrasis-repair/.venv/bin/pip install -e /opt/domainpatrol/ekphrasis-repair
sudo install -o root -g root -m 0600 /dev/null /etc/ekphrasis-repair.env
```

Put a fresh `openssl rand -hex 32` value in `EKPHRASIS_AGENT_SECRET` in `/etc/ekphrasis-repair.env`, alongside `CODEX_HOME=/opt/domainpatrol/.codex`, `HOME=/opt/domainpatrol`, and `CODEX_WORK_ROOT=/opt/domainpatrol/ekphrasis-repair/work`. Keep the secret out of Git. Codex CLI is already installed and authenticated for `domainpatrol`; verify it without creating another login:

```sh
sudo -u domainpatrol env HOME=/opt/domainpatrol CODEX_HOME=/opt/domainpatrol/.codex codex login status
sudo -u domainpatrol codex --version
```

The service unit uses Codex's read-only sandbox for each request. It does not pass `EKPHRASIS_AGENT_SECRET` into the Codex child process. Codex runs as `domainpatrol` and uses that account's existing authentication state and filesystem access.

Install `deploy/ekphrasis-codex-vision.service` as `/etc/systemd/system/ekphrasis-codex-vision.service`, then enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now ekphrasis-codex-vision
curl --fail http://127.0.0.1:8787/health
```

Configure Caddy with `deploy/Caddyfile.example`, replacing `vision.example.com` with the chosen DNS name. Point that name at the Droplet and reload Caddy. Uvicorn remains bound to loopback; only the HTTPS proxy is public.

## Vercel configuration

Set these in the Vercel project environment for the intended deployment:

- `EKPHRASIS_AGENT_URL=https://your-vision-host.example.com`
- `EKPHRASIS_AGENT_SECRET=<the same generated secret as the service env file>`

Redeploy after changing environment values. The TypeScript adapter falls back to Hugging Face when either variable is absent, which is the rollback path.

## Request and limits

- `GET /health` returns a minimal health response and does not disclose configuration.
- `POST /v1/identify` requires `Authorization: Bearer …` and accepts only the versioned JSON schema.
- Only normalized JPEG image data and whitelisted filename/metadata clues cross the bridge. GPS, timestamps, camera identifiers, and arbitrary metadata are rejected or omitted upstream.
- Request body limit: 6 MiB. Decoded image limit: 4 MiB. One active Codex request; additional requests receive HTTP 429 with `Retry-After`.
- Codex timeout: 240 seconds by default. The Vercel route budget is 300 seconds.
- The service gives Codex filename and metadata as untrusted clues. Codex output is a candidate only; museum evidence remains authoritative.
- Request images and generated output files live in a temporary directory and are removed after each run.

## Smoke test and rollback

From an authorized machine, check `https://your-vision-host.example.com/health`. For an authenticated `POST /v1/identify` smoke test, use a small normalized JPEG and the same secret stored in Vercel; do not put the real secret in shell history or logs.

To roll back the application provider, remove `EKPHRASIS_AGENT_URL` and `EKPHRASIS_AGENT_SECRET` from the Vercel environment and redeploy. The service can then be stopped independently with `sudo systemctl disable --now ekphrasis-codex-vision`.
