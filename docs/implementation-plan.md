# VeriReview AI implementation plan

Build the local pre-review workflow first, then extend the same engine to GitHub and AWS. Version: 0.1.0. The source requirements are in `prompt.md`.

## Delivery sequence

1. **Foundation:** FastAPI application, validated shared contracts, API authentication, health endpoint, TypeScript extension and API client, Docker Compose, tests and launch configuration.
2. **Git:** safe Git CLI integration; working, staged, branch and current-file modes; normalized paths, hunks and changed lines; binary/generated-file filtering and explicit budgets.
3. **AI:** deterministic mock provider, Bedrock Converse adapter, dedicated prompts, schema validation and one bounded repair attempt.
4. **Diagnostics:** Problems panel, location navigation, progress, cancellation, status bar and obsolete-result clearing.
5. **Static analysis:** bounded Semgrep subprocess, curated local rules, changed-line filtering and graceful degradation.
6. **Evidence:** server-owned provenance, confidence aggregation, deduplication, ranking and noise filtering.
7. **Sidebar:** native severity groups, summary, finding details, evidence and coverage.
8. **Context:** bounded local retrieval of related definitions and tests; never upload the whole repository.
9. **Team rules:** validated `.verireview.yml`, useful validation errors and no executable configuration.
10. **Fixes:** patch preview, explicit user application and stale-source protection.
11. **GitHub:** PR source adapter sharing the orchestrator; valid inline locations and summary; opt-in posting.
12. **AWS:** TypeScript CDK, ECR, ECS Fargate, HTTPS ingress, scoped IAM, DynamoDB metadata and CloudWatch; OIDC deployment workflow.
13. **Verification:** optional isolated test runner only after the core flow is stable. Never execute repository tests in the API process.

## Architecture and boundaries

- `extension/`: Git and repository context stay local; only bounded review inputs cross HTTP. Secrets use VS Code SecretStorage.
- `backend/app/`: routes validate and delegate; provider/analyzer adapters feed one review engine.
- `contracts/`: generated OpenAPI contract, shared with runtime-validated TypeScript responses.
- `infrastructure/`: deployment definitions; no cloud resources created during scaffolding.
- `examples/`: intentional demo defects containing no real credentials.
- `docs/`: setup, architecture, security and verification records.

Use one-based repository-relative finding locations in the API and zero-based editor locations. Treat source, configuration and model output as untrusted. Confidence is an evidence score, not a calibrated probability. Mock results must be labelled as mock. Never claim deterministic verification from model assertions.

## Acceptance gates

At each phase run its relevant tests and compile/type-check affected code. The final gate includes an actual Git diff → HTTP review → VS Code diagnostics demo, backend lint/type checks/tests, extension lint/compile/tests/package, Docker build and CDK synthesis. Record unavailable checks explicitly.

## Credentials and decisions

Local development starts with `AI_PROVIDER=mock` and needs no credentials. Bedrock later requires an AWS profile/normal credential chain, region and accessible model ID. Deployment additionally requires account, region, resource-creation approval, and TLS/domain choices. GitHub needs a target repository and integration preference. Never paste secret keys into chat; configure them locally or in a secret manager.

## Initial environment inspection

The workspace initially contains only `prompt.md`. Python 3.14, Node 24, npm 11, Git and VS Code CLI are installed. Docker and uv are absent. Use a workspace Python virtual environment and npm lockfiles; target Python 3.12+ in packaging. Docker verification remains dependent on Docker installation.

## First implementation checkpoint

### Editor checklist addition

Git AI integration: all four Git review commands now share the saved direct AI connection
and checklist, including custom rules. The panel offers matching scopes. Requests send
bounded per-file diffs; patch line locations are mapped to source additions only. Problems
and a dedicated Output channel show results. Snapshot mismatches block staged/branch
navigation, and stale diffs or edited documents invalidate results. The previous backend
workflow remains an explicitly named legacy command. Live paid-provider verification is
still pending; HTTP tests use simulated responses.

Added a startup checklist panel with persisted toggle selections, automatic model selection, and
provider-specific SecretStorage keys for OpenAI, Claude, Grok, and Groq. Setup asks only for a key:
recognized prefixes select the provider locally, then its model list is checked against a
supported model preference list. Unknown or ambiguous key formats are rejected locally.
An optional custom connection accepts an explicit API base URL and model for services
compatible with OpenAI Chat Completions and Bearer authentication. Custom access is
checked on review; no credentials are probed across providers. Remote endpoints require HTTPS.
Direct provider requests
review the current editor snapshot, including unsaved edits, independently of the backend.
Findings are validated against selected check IDs and source line bounds, displayed in
the panel and Problems, and invalidated on edits. Requests support cancellation, timeouts,
input/output limits, and sanitized provider errors. Existing Git commands retain their
backend behavior. This addition does not implement local static analyzers or Bedrock.

Provider adapters are covered by mocked HTTP tests; real paid-provider calls and interactive
VS Code rendering still require manual verification with a user-provided API key.

Implemented the foundation and an initial Git → mock review → diagnostics/sidebar slice.
This is not completion of all phases. Git rename/deletion modeling, snapshot-aware editor
navigation, Bedrock, Semgrep and later milestones remain outstanding.

Verified on the initial machine:

- Backend: 10 tests pass; Ruff and strict mypy pass.
- Extension: TypeScript compiles; ESLint passes; 4 tests pass using real HTTP and Git.
- Live integration: `node scripts/smoke.cjs` passes against a spawned Uvicorn backend,
  collecting a real Git diff through the compiled extension modules and asserting line 2.
- VSIX packaging succeeds: `extension/verireview-ai-0.1.0.vsix`.
- npm install audit reports no vulnerabilities. Python dependency vulnerability audit
  has not been run; the lockfile records this Windows/Python 3.14 development environment.

Not yet verified: interactive VS Code rendering/navigation, Docker build, Linux/Python 3.12
CI execution, or cloud infrastructure. The CI workflow is authored but has not run remotely.
Backend tests currently report upstream Starlette/HTTPX deprecation warnings.
