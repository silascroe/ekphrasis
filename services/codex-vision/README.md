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

The example unit expects Ubuntu, a dedicated `ekphrasis` account, Codex CLI installed for that account, and this service checked out at `/opt/ekphrasis/codex-vision`. Keep the application tree operator-owned and readable by the service account; Codex should not be able to modify its own service code.

Create the account and writable runtime directories:

```sh
sudo useradd --system --create-home --home-dir /home/ekphrasis --shell /usr/sbin/nologin ekphrasis
sudo install -d -o root -g ekphrasis -m 0750 /opt/ekphrasis/codex-vision
sudo install -d -o ekphrasis -g ekphrasis -m 0700 /home/ekphrasis/.codex /home/ekphrasis/.cache /home/ekphrasis/work
```

Install the repository's service files into `/opt/ekphrasis/codex-vision`, then create the environment and virtual environment:

```sh
sudo python3 -m venv /opt/ekphrasis/codex-vision/.venv
sudo /opt/ekphrasis/codex-vision/.venv/bin/pip install -e /opt/ekphrasis/codex-vision
sudo install -d -o root -g ekphrasis -m 0750 /etc/ekphrasis
sudo install -o root -g ekphrasis -m 0640 services/codex-vision/.env.example /etc/ekphrasis/codex-vision.env
```

Edit `/etc/ekphrasis/codex-vision.env` and replace the placeholder with a fresh value from `openssl rand -hex 32`. Keep this secret out of Git. Install `deploy/codex-config.toml.example` as `/home/ekphrasis/.codex/config.toml`, owned by `ekphrasis` with mode `0600`. Install Codex CLI, then authenticate it interactively as the service account:

```sh
sudo -u ekphrasis -H codex login
sudo -u ekphrasis -H codex --version
```

The service unit uses Codex's read-only sandbox for each request. It does not pass `EKPHRASIS_AGENT_SECRET` into the Codex child process. Codex can read files available to the dedicated service account, including its own authentication state; keep unrelated user data and credentials out of that account.

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
