import hashlib
import re
from collections.abc import Iterator
from time import perf_counter
from typing import Protocol

from app.models import (
    Category,
    ChangedFile,
    Coverage,
    Evidence,
    Finding,
    ReviewRequest,
    ReviewResponse,
    Severity,
)

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def added_lines(diff: str) -> Iterator[tuple[int, str]]:
    """Read new-side positions; header-like source lines remain source inside hunks."""
    line_number: int | None = None
    for line in diff.splitlines():
        match = HUNK.match(line)
        if match:
            line_number = int(match.group(1))
        elif line_number is not None:
            if line.startswith("+"):
                yield line_number, line[1:]
                line_number += 1
            elif line.startswith(" "):
                line_number += 1


class AIReviewProvider(Protocol):
    async def review(self, files: list[ChangedFile]) -> list[Finding]: ...


class MockReviewProvider:
    """Deliberately narrow demo fixture; does not pretend to perform semantic AI review."""

    async def review(self, files: list[ChangedFile]) -> list[Finding]:
        findings: list[Finding] = []
        for file in files:
            for number, code in added_lines(file.diff):
                if not re.search(r"\b(password|api_key|secret)\s*=\s*['\"][^'\"]+['\"]", code):
                    continue
                fingerprint = hashlib.sha256(
                    f"mock.literal-secret:{file.path}:{code.strip()}".encode()
                ).hexdigest()
                findings.append(
                    Finding(
                        file_path=file.path,
                        start_line=number,
                        end_line=number,
                        severity=Severity.HIGH,
                        category=Category.SECURITY,
                        title="Possible hardcoded credential (mock review)",
                        description="A changed assignment matches the demo credential pattern.",
                        why_it_matters="Credentials in source can be exposed through history.",
                        suggestion="Use approved secret management and rotate real credentials.",
                        confidence=0.75,
                        evidence=[
                            Evidence(
                                type="MOCK_PATTERN",
                                source="mock.literal-secret",
                                description="Demo literal-assignment match; no AI call was made.",
                            )
                        ],
                        source="mock",
                        rule_id="mock.literal-secret",
                        fingerprint=fingerprint,
                    )
                )
        return findings


class ReviewOrchestrator:
    def __init__(self, provider: AIReviewProvider) -> None:
        self.provider = provider

    async def run(self, request: ReviewRequest) -> ReviewResponse:
        start = perf_counter()
        skipped = [f.path for f in request.files if not list(added_lines(f.diff))]
        files = [f for f in request.files if f.path not in skipped]
        candidates = await self.provider.review(files)
        unique = {
            f.fingerprint: f for f in candidates if f.confidence >= request.minimum_confidence
        }
        findings = sorted(unique.values(), key=lambda f: list(Severity).index(f.severity))
        findings = findings[: request.max_findings]
        return ReviewResponse(
            repository=request.repository,
            branch=request.branch,
            provider="mock",
            files_reviewed=len(files),
            duration_ms=int((perf_counter() - start) * 1000),
            summary={s.value.lower(): sum(f.severity == s for f in findings) for s in Severity},
            findings=findings,
            coverage=Coverage(
                submitted_files=len(request.files), analyzed_files=len(files), skipped_files=skipped
            ),
            warnings=[
                "Mock mode: deterministic demo patterns only. Semgrep and Bedrock are not run."
            ],
        )
