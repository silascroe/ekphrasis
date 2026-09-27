import base64
import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.models import IdentifyResponse, MAX_IMAGE_BYTES, MAX_REQUEST_BODY_BYTES, Settings


SECRET = "test-bridge-secret-that-is-long-enough"
IMAGE = b"\xff\xd8\xfftest-image-bytes"


def request_payload(**changes):
    payload = {
        "version": 1,
        "request_id": "123e4567-e89b-12d3-a456-426614174000",
        "image": {
            "mime_type": "image/jpeg",
            "base64": base64.b64encode(IMAGE).decode("ascii"),
        },
        "context": {
            "original_filename": "The_Work.jpg",
            "original_mime_type": "image/heic",
            "original_size": 2_400_000,
            "embedded": {"title": "The Work", "artist": "Painter", "document_name": "Catalog Entry 73"},
        },
    }
    payload.update(changes)
    return payload


def result() -> IdentifyResponse:
    return IdentifyResponse(
        artist="Painter",
        title="The Work",
        year="1901",
        medium=None,
        candidates=[{"text": "distinctive catalog phrase"}],
        confidence="high",
        source_urls=["https://museum.example/object/42"],
        evidence=["The signature reads Painter."],
    )


async def response_for(app, payload=None, authorization: str | None = f"Bearer {SECRET}"):
    headers = {}
    if authorization is not None:
        headers["Authorization"] = authorization
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(
            "/v1/identify",
            json=payload if payload is not None else request_payload(),
            headers=headers,
        )


def build_app(runner=None):
    async def default_runner(_request, _settings):
        return result()

    return create_app(settings=Settings(agent_secret=SECRET), runner=runner or default_runner)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.parametrize("authorization", [None, "Bearer wrong-secret", "Basic test"])
async def test_missing_or_wrong_bearer_secret_returns_401(authorization):
    app = build_app()
    response = await response_for(app, authorization=authorization)
    assert response.status_code == 401


@pytest.mark.anyio
async def test_missing_service_secret_returns_503_without_running_codex():
    async def unexpected_runner(*_args):
        raise AssertionError("runner must not be called without server credentials")

    app = create_app(settings=Settings(agent_secret=""), runner=unexpected_runner)
    response = await response_for(app)

    assert response.status_code == 503


@pytest.mark.anyio
async def test_unsupported_image_mime_returns_400():
    payload = request_payload()
    payload["image"]["mime_type"] = "image/svg+xml"

    response = await response_for(build_app(), payload)

    assert response.status_code == 400


@pytest.mark.anyio
async def test_malformed_json_returns_400():
    app = build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/v1/identify",
            content=b"{not-json",
            headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
        )

    assert response.status_code == 400


@pytest.mark.anyio
async def test_image_larger_than_decoded_limit_returns_413():
    payload = request_payload()
    payload["image"]["base64"] = base64.b64encode(b"x" * (MAX_IMAGE_BYTES + 1)).decode("ascii")

    response = await response_for(build_app(), payload)

    assert response.status_code == 413


@pytest.mark.anyio
async def test_request_body_over_limit_returns_413():
    app = build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/v1/identify",
            content=b"x" * (MAX_REQUEST_BODY_BYTES + 1),
            headers={"Authorization": f"Bearer {SECRET}"},
        )

    assert response.status_code == 413


@pytest.mark.anyio
async def test_unknown_upload_context_fields_return_400():
    payload = request_payload()
    payload["context"]["embedded"]["gps"] = "51.5, -0.1"

    response = await response_for(build_app(), payload)

    assert response.status_code == 400


@pytest.mark.anyio
async def test_valid_request_returns_the_exact_candidate_schema():
    response = await response_for(build_app())

    assert response.status_code == 200
    assert response.json() == {
        "artist": "Painter",
        "title": "The Work",
        "year": "1901",
        "medium": None,
        "candidates": [{"text": "distinctive catalog phrase"}],
        "confidence": "high",
        "source_urls": ["https://museum.example/object/42"],
        "evidence": ["The signature reads Painter."],
    }


@pytest.mark.anyio
async def test_concurrent_request_is_rejected_while_codex_is_running():
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_runner(_request, _settings):
        started.set()
        await release.wait()
        return result()

    app = build_app(slow_runner)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = asyncio.create_task(client.post(
            "/v1/identify",
            json=request_payload(),
            headers={"Authorization": f"Bearer {SECRET}"},
        ))
        await asyncio.wait_for(started.wait(), timeout=1)
        second = await client.post(
            "/v1/identify",
            json=request_payload(),
            headers={"Authorization": f"Bearer {SECRET}"},
        )
        release.set()
        first_response = await first

    assert first_response.status_code == 200
    assert second.status_code == 429
    assert second.headers["Retry-After"] == "30"
