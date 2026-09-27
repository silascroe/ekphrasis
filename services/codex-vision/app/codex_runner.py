from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import tempfile
from pathlib import Path

from pydantic import ValidationError

from .models import MAX_IMAGE_BYTES, IdentifyRequest, IdentifyResponse, Settings
from .prompt import build_prompt

logger = logging.getLogger("ekphrasis.codex_vision.runner")
_CODEX_SEMAPHORE = asyncio.Semaphore(1)


class CodexRunnerError(RuntimeError):
    """A safe, content-free Codex execution or output failure."""


class CodexTimeoutError(TimeoutError):
    """Codex exceeded its configured execution deadline."""


def _decode_image(request: IdentifyRequest) -> bytes:
    try:
        image = base64.b64decode(request.image.base64, validate=True)
    except (binascii.Error, ValueError):
        raise CodexRunnerError("Image data is invalid.") from None
    if not image or len(image) > MAX_IMAGE_BYTES:
        raise CodexRunnerError("Image data is outside the supported size range.")
    return image


def _codex_environment() -> dict[str, str]:
    allowed = {
        "PATH",
        "HOME",
        "CODEX_HOME",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
    }
    return {key: value for key, value in os.environ.items() if key in allowed}


async def _kill_and_reap(process) -> None:
    try:
        process.kill()
    except ProcessLookupError:
        pass
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except (TimeoutError, ProcessLookupError):
        pass


async def identify_with_codex(request: IdentifyRequest, settings: Settings) -> IdentifyResponse:
    if not settings.agent_secret:
        raise CodexRunnerError("Codex bridge authentication is not configured.")
    if not settings.schema_path.is_file():
        raise CodexRunnerError("Codex output schema is unavailable.")
    if not settings.work_root.is_dir():
        raise CodexRunnerError("Codex work directory is unavailable.")

    image_bytes = _decode_image(request)
    async with _CODEX_SEMAPHORE:
        with tempfile.TemporaryDirectory(prefix="ekphrasis-codex-", dir=settings.work_root) as directory:
            workdir = Path(directory)
            image_path = workdir / "input.jpg"
            output_path = workdir / "last-message.json"
            image_path.write_bytes(image_bytes)
            prompt = build_prompt(request)

            argv = [settings.codex_bin, "--search"]
            if settings.model:
                argv.extend(["--model", settings.model])
            if settings.profile:
                argv.extend(["--profile", settings.profile])
            argv.extend([
                "exec",
                "--ephemeral",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--image",
                str(image_path),
                "--output-schema",
                str(settings.schema_path),
                "--output-last-message",
                str(output_path),
                prompt,
            ])

            started = asyncio.get_running_loop().time()
            try:
                process = await asyncio.create_subprocess_exec(
                    *argv,
                    cwd=str(workdir),
                    env=_codex_environment(),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            except OSError:
                logger.info("codex_start_failed", extra={"request_id": request.request_id})
                raise CodexRunnerError("Codex CLI could not be started.") from None

            try:
                await asyncio.wait_for(process.communicate(), timeout=settings.timeout_seconds)
            except TimeoutError:
                await _kill_and_reap(process)
                logger.info(
                    "codex_timed_out",
                    extra={
                        "request_id": request.request_id,
                        "elapsed_ms": round((asyncio.get_running_loop().time() - started) * 1000),
                    },
                )
                raise CodexTimeoutError("Codex identification timed out.") from None
            except asyncio.CancelledError:
                await _kill_and_reap(process)
                raise

            if process.returncode != 0:
                logger.info(
                    "codex_failed",
                    extra={
                        "request_id": request.request_id,
                        "returncode": process.returncode,
                        "elapsed_ms": round((asyncio.get_running_loop().time() - started) * 1000),
                    },
                )
                raise CodexRunnerError("Codex identification failed.")

            try:
                raw = output_path.read_text(encoding="utf-8")
                output = json.loads(raw)
                response = IdentifyResponse.model_validate(output)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError):
                logger.info(
                    "codex_invalid_response",
                    extra={
                        "request_id": request.request_id,
                        "elapsed_ms": round((asyncio.get_running_loop().time() - started) * 1000),
                    },
                )
                raise CodexRunnerError("Codex returned an invalid response.") from None

            logger.info(
                "codex_completed",
                extra={
                    "request_id": request.request_id,
                    "image_bytes": len(image_bytes),
                    "elapsed_ms": round((asyncio.get_running_loop().time() - started) * 1000),
                    "confidence": response.confidence,
                },
            )
            return response
