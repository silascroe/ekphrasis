import asyncio
import base64
import json
from pathlib import Path

import pytest

from app.codex_runner import CodexRunnerError, CodexTimeoutError, identify_with_codex
from app.models import IdentifyRequest, Settings


IMAGE = b"\xff\xd8\xffnormalized-test-image"
RESPONSE = {
    "artist": "Painter",
    "title": "The Work",
    "year": "1901",
    "medium": None,
    "candidates": [{"text": "distinctive catalog phrase"}],
    "confidence": "high",
    "source_urls": ["https://museum.example/object/42"],
    "evidence": ["The signature reads Painter."],
}


def request() -> IdentifyRequest:
    return IdentifyRequest.model_validate({
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
    })


def settings(tmp_path: Path, timeout: float = 2.0) -> Settings:
    schema = tmp_path / "artwork-identification.schema.json"
    schema.write_text("{}", encoding="utf-8")
    return Settings(
        agent_secret="test-secret",
        codex_bin="codex",
        timeout_seconds=timeout,
        model="gpt-6-luna-max",
        profile="artwork-research",
        schema_path=schema,
    )


class FakeProcess:
    returncode = 0

    async def communicate(self):
        return b"", b""

    async def wait(self):
        return self.returncode


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_invokes_codex_with_fixed_flags_and_cleans_generated_files(monkeypatch, tmp_path):
    call = {}
    monkeypatch.setenv("EKPHRASIS_AGENT_SECRET", "must-not-reach-codex")

    async def fake_exec(*args, **kwargs):
        call["args"] = args
        call["kwargs"] = kwargs
        image_path = Path(args[args.index("--image") + 1])
        call["image_bytes"] = image_path.read_bytes()
        output_path = Path(args[args.index("--output-last-message") + 1])
        output_path.write_text(json.dumps(RESPONSE), encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    response = await identify_with_codex(request(), settings(tmp_path))

    argv = list(call["args"])
    cwd = Path(call["kwargs"]["cwd"])
    image_path = Path(argv[argv.index("--image") + 1])
    output_path = Path(argv[argv.index("--output-last-message") + 1])
    prompt = argv[-1]
    assert response.model_dump(mode="json") == RESPONSE
    assert argv[0] == "codex"
    assert argv.index("--search") < argv.index("exec")
    assert "--ephemeral" in argv
    assert argv[argv.index("--sandbox") + 1] == "read-only"
    assert "--skip-git-repo-check" in argv
    assert argv[argv.index("--model") + 1] == "gpt-6-luna-max"
    assert argv[argv.index("--profile") + 1] == "artwork-research"
    assert argv[argv.index("--output-schema") + 1] == str(tmp_path / "artwork-identification.schema.json")
    assert image_path.name == "input.jpg"
    assert call["image_bytes"] == IMAGE
    assert output_path.parent == cwd
    assert "The_Work.jpg" in prompt
    assert "Catalog Entry 73" in prompt
    assert "untrusted clues" in prompt.lower()
    assert "minimum authoritative verification" in prompt.lower()
    assert "The_Work.jpg" not in str(image_path)
    assert "shell" not in call["kwargs"]
    assert "EKPHRASIS_AGENT_SECRET" not in call["kwargs"]["env"]
    assert not cwd.exists()


@pytest.mark.anyio
@pytest.mark.parametrize("output", ["not-json", json.dumps({**RESPONSE, "candidates": "not-an-array"})])
async def test_invalid_codex_output_fails_and_removes_temp_directory(monkeypatch, tmp_path, output):
    call = {}

    async def fake_exec(*args, **kwargs):
        call["cwd"] = Path(kwargs["cwd"])
        output_path = Path(args[args.index("--output-last-message") + 1])
        output_path.write_text(output, encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    with pytest.raises(CodexRunnerError):
        await identify_with_codex(request(), settings(tmp_path))

    assert not call["cwd"].exists()


@pytest.mark.anyio
async def test_timeout_kills_codex_and_removes_temp_directory(monkeypatch, tmp_path):
    call = {}

    class SlowProcess(FakeProcess):
        def __init__(self):
            self.killed = False

        async def communicate(self):
            await asyncio.sleep(30)
            return b"", b""

        async def wait(self):
            return -9

        def kill(self):
            self.killed = True

    process = SlowProcess()

    async def fake_exec(*_args, **kwargs):
        call["cwd"] = Path(kwargs["cwd"])
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    with pytest.raises(CodexTimeoutError):
        await identify_with_codex(request(), settings(tmp_path, timeout=0.01))

    assert process.killed
    assert not call["cwd"].exists()
