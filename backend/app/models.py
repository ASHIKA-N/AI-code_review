import re
from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Severity(StrEnum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    SUGGESTION = "SUGGESTION"


class Category(StrEnum):
    CORRECTNESS = "CORRECTNESS"
    SECURITY = "SECURITY"
    PERFORMANCE = "PERFORMANCE"
    ERROR_HANDLING = "ERROR_HANDLING"
    TESTING = "TESTING"
    MAINTAINABILITY = "MAINTAINABILITY"
    OBSERVABILITY = "OBSERVABILITY"
    ARCHITECTURE = "ARCHITECTURE"
    TEAM_STANDARD = "TEAM_STANDARD"
    RELIABILITY = "RELIABILITY"


def safe_path(value: str) -> str:
    if (
        not value
        or value.startswith(("/", "\\"))
        or "\\" in value
        or re.search(r"[\x00-\x1f:]", value)
        or any(part in ("", ".", "..") for part in value.split("/"))
    ):
        raise ValueError("Expected a safe repository-relative POSIX path")
    return value


class ChangedFile(Contract):
    path: str = Field(max_length=512)
    diff: str = Field(max_length=200_000)

    _path = field_validator("path")(safe_path)


class ReviewRequest(Contract):
    repository: str = Field(min_length=1, max_length=200)
    branch: str = Field(max_length=200)
    files: list[ChangedFile] = Field(max_length=100)
    minimum_confidence: float = Field(default=0.70, ge=0, le=1)
    max_findings: int = Field(default=10, ge=1, le=50)

    @model_validator(mode="after")
    def budget(self) -> "ReviewRequest":
        if sum(len(f.diff.encode("utf-8")) for f in self.files) > 500_000:
            raise ValueError(
                "Review exceeds the 500 KB diff budget; use staged or current-file review"
            )
        if len({f.path for f in self.files}) != len(self.files):
            raise ValueError("Duplicate file paths")
        return self


class Evidence(Contract):
    type: str
    description: str
    source: str


class Finding(Contract):
    id: str = Field(default_factory=lambda: str(uuid4()))
    file_path: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    severity: Severity
    category: Category
    title: str
    description: str
    why_it_matters: str
    suggestion: str
    confidence: float = Field(ge=0, le=1)
    evidence: list[Evidence]
    source: str
    rule_id: str
    suggested_patch: str | None = None
    verification_status: str = "POSSIBLE"
    fingerprint: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Coverage(Contract):
    submitted_files: int
    analyzed_files: int
    skipped_files: list[str]


class ReviewResponse(Contract):
    review_id: str = Field(default_factory=lambda: str(uuid4()))
    repository: str
    branch: str
    provider: str
    files_reviewed: int
    duration_ms: int
    summary: dict[str, int]
    findings: list[Finding]
    coverage: Coverage
    warnings: list[str]


class HealthResponse(Contract):
    status: str = "ok"
    version: str
    ai_provider: str
    ai_configured: bool
    semgrep_available: bool
