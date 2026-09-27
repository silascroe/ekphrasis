from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field


MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_REQUEST_BODY_BYTES = 6 * 1024 * 1024
MAX_BASE64_CHARS = MAX_REQUEST_BODY_BYTES


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ImageInput(StrictModel):
    mime_type: Literal["image/jpeg"]
    base64: str = Field(min_length=4, max_length=MAX_BASE64_CHARS)


class EmbeddedMetadata(StrictModel):
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=2000)
    artist: str | None = Field(default=None, max_length=500)
    copyright: str | None = Field(default=None, max_length=1000)
    subject: str | None = Field(default=None, max_length=1000)
    document_name: str | None = Field(default=None, max_length=500)
    comment: str | None = Field(default=None, max_length=1000)


class UploadContext(StrictModel):
    original_filename: str = Field(min_length=1, max_length=512)
    original_mime_type: str | None = Field(max_length=128)
    original_size: int = Field(ge=0, le=50 * 1024 * 1024)
    embedded: EmbeddedMetadata | None = None


class IdentifyRequest(StrictModel):
    version: Literal[1]
    request_id: str = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        max_length=36,
    )
    image: ImageInput
    context: UploadContext | None = None


class CandidatePhrase(StrictModel):
    text: str = Field(min_length=1, max_length=1000)


class IdentifyResponse(StrictModel):
    artist: str | None = Field(max_length=1000)
    title: str | None = Field(max_length=1000)
    year: str | None = Field(max_length=100)
    medium: str | None = Field(max_length=1000)
    candidates: list[CandidatePhrase] = Field(max_length=8)
    confidence: Literal["high", "medium", "low"]
    source_urls: list[AnyHttpUrl] = Field(max_length=8)
    evidence: list[Annotated[str, Field(max_length=2000)]] = Field(max_length=8)


@dataclass(frozen=True)
class Settings:
    agent_secret: str = ""
    codex_bin: str = "codex"
    timeout_seconds: float = 240.0
    model: str | None = None
    profile: str | None = None
    work_root: Path = field(default_factory=lambda: Path(os.environ.get("CODEX_WORK_ROOT", "/tmp")))
    schema_path: Path = field(
        default_factory=lambda: Path(__file__).resolve().parents[1] / "artwork-identification.schema.json"
    )

    @classmethod
    def from_env(cls) -> Settings:
        timeout_raw = os.environ.get("CODEX_TIMEOUT_SECONDS", "240")
        try:
            timeout_seconds = float(timeout_raw)
        except ValueError:
            timeout_seconds = 240.0
        if timeout_seconds <= 0:
            timeout_seconds = 240.0

        return cls(
            agent_secret=os.environ.get("EKPHRASIS_AGENT_SECRET", ""),
            codex_bin=os.environ.get("CODEX_BIN", "codex") or "codex",
            timeout_seconds=min(timeout_seconds, 250.0),
            model=os.environ.get("CODEX_MODEL") or None,
            profile=os.environ.get("CODEX_PROFILE") or None,
            work_root=Path(os.environ.get("CODEX_WORK_ROOT", "/tmp")).expanduser(),
        )
