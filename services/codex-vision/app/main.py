from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import logging
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .models import (
    MAX_IMAGE_BYTES,
    MAX_REQUEST_BODY_BYTES,
    IdentifyRequest,
    IdentifyResponse,
    Settings,
)

logger = logging.getLogger("ekphrasis.codex_vision")
Runner = Callable[[IdentifyRequest, Settings], Awaitable[IdentifyResponse]]


async def _default_runner(request: IdentifyRequest, settings: Settings) -> IdentifyResponse:
    from .codex_runner import identify_with_codex

    return await identify_with_codex(request, settings)


def create_app(settings: Settings | None = None, runner: Runner | None = None) -> FastAPI:
    active_settings = settings or Settings.from_env()
    identify = runner or _default_runner
    semaphore = asyncio.Semaphore(1)
    app = FastAPI(
        title="Ekphrasis Codex Vision Bridge",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/identify")
    async def identify_artwork(request: Request):
        if not active_settings.agent_secret:
            return JSONResponse({"detail": "Service is not configured."}, status_code=503)

        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            return JSONResponse({"detail": "Authentication required."}, status_code=401)
        supplied_secret = authorization.removeprefix("Bearer ")
        try:
            authorized = hmac.compare_digest(
                supplied_secret.encode("utf-8"), active_settings.agent_secret.encode("utf-8")
            )
        except UnicodeEncodeError:
            authorized = False
        if not authorized:
            return JSONResponse({"detail": "Authentication required."}, status_code=401)

        declared_length = request.headers.get("content-length")
        if declared_length:
            try:
                if int(declared_length) > MAX_REQUEST_BODY_BYTES:
                    return JSONResponse({"detail": "Request body is too large."}, status_code=413)
            except ValueError:
                return JSONResponse({"detail": "Invalid content length."}, status_code=400)

        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_REQUEST_BODY_BYTES:
                return JSONResponse({"detail": "Request body is too large."}, status_code=413)

        try:
            payload = IdentifyRequest.model_validate_json(bytes(raw))
        except ValidationError:
            return JSONResponse({"detail": "Request schema is invalid."}, status_code=400)

        try:
            image_bytes = base64.b64decode(payload.image.base64, validate=True)
        except (binascii.Error, ValueError):
            return JSONResponse({"detail": "Image data is invalid."}, status_code=400)
        if not image_bytes:
            return JSONResponse({"detail": "Image data is empty."}, status_code=400)
        if len(image_bytes) > MAX_IMAGE_BYTES:
            return JSONResponse({"detail": "Image exceeds the size limit."}, status_code=413)

        if semaphore.locked():
            return JSONResponse(
                {"detail": "Codex vision service is busy."},
                status_code=429,
                headers={"Retry-After": "30"},
            )
        await semaphore.acquire()
        try:
            result = await identify(payload, active_settings)
            if not isinstance(result, IdentifyResponse):
                result = IdentifyResponse.model_validate(result)
        except TimeoutError:
            logger.info("identify_failed", extra={"request_id": payload.request_id, "failure": "TIMEOUT"})
            return JSONResponse({"detail": "Codex request timed out."}, status_code=504)
        except ValidationError:
            logger.info("identify_failed", extra={"request_id": payload.request_id, "failure": "INVALID_RESPONSE"})
            return JSONResponse({"detail": "Codex returned an invalid response."}, status_code=502)
        except Exception:
            logger.info("identify_failed", extra={"request_id": payload.request_id, "failure": "PROVIDER_ERROR"})
            return JSONResponse({"detail": "Codex identification failed."}, status_code=502)
        finally:
            semaphore.release()

        return JSONResponse(result.model_dump(mode="json"), status_code=200)

    return app


app = create_app()
