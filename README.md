# VeriReview AI

**Evidence-Based AI Code Review for Developers** — Review before the reviewer.

VeriReview is being built as a VS Code extension backed by FastAPI. It reviews Git changes
before human review, with structured findings, evidence and confidence scores.

## Current implementation

The first local slice includes four Git review modes, a runtime-validated HTTP client,
FastAPI health and review endpoints, a deterministic mock reviewer, Problems-panel
diagnostics, severity-grouped sidebar, finding navigation and evidence details. Requests
have bounded sizes; remote backends require HTTPS; API keys use VS Code SecretStorage.

**This is an early implementation, not the completed master prompt.** Bedrock, Semgrep
execution, repository context, team rules, suggested fixes, feedback storage, PR integration,
AWS infrastructure and isolated verification are subsequent milestones. The mock reviewer
only recognizes credential-like literal assignments. It does not call an AI model.

See [the implementation plan](docs/implementation-plan.md) for the full sequence.

## Start locally (PowerShell)

Requires Python 3.12+, Node.js 22+, Git and VS Code.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e './backend[dev]'
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
cd extension
npm ci
npm run compile
```

Open the project root in VS Code and press **F5**, selecting **Run VeriReview Extension**.
In the development host, open a Git repository and run **VeriReview: Check Backend Connection**.
Save changed files, then run **VeriReview: Review My Changes**. The
[sample project](examples/sample-project/README.md) gives a reproducible mock finding.

Other modes: **Review Staged Changes**, **Review Current Branch**, **Review Current File**.
Working mode compares HEAD with the working tree (including staged changes); staged mode
uses the index. Branch mode compares the configured base's merge base with HEAD.
Untracked files must be staged. Deletions and renames are not yet represented as rich
change records; rename additions are reviewed as new paths. Generated/binary candidates
and files beyond budgets are reported in the output channel.

Staged/branch finding locations describe their reviewed Git snapshot; if your working
tree differs, editor positions can differ. Use a clean working tree for those modes until
snapshot-aware navigation is implemented.

The backend defaults to unauthenticated mock mode for loopback development. Set
`VERIREVIEW_API_KEY` in your environment or root `.env` and use **Configure Backend** to
save the matching key in SecretStorage. `APP_ENV=production` requires a key.

Interactive API docs: <http://127.0.0.1:8000/docs>. Health: <http://127.0.0.1:8000/api/v1/health>.

## Docker

With Docker installed, run `docker compose up --build`. The port binds only to loopback.
The image runs as a non-root user. Docker builds have not yet been verified on the initial
development machine because Docker is not installed. Semgrep is not yet included.

## Validation

```powershell
.\.venv\Scripts\python -m pytest backend/tests
.\.venv\Scripts\python -m ruff check backend
.\.venv\Scripts\python -m mypy backend/app
.\.venv\Scripts\python scripts/export_contract.py
cd extension
npm run lint
npm test
npm run package
```

`contracts/openapi.json` is exported from Pydantic. The extension validates backend
responses with Zod. Packaging is local only; nothing is published to Marketplace.

After compiling the extension, run `node scripts/smoke.cjs` from the root for a live
Git → extension client → backend check. It starts a temporary backend on port 18764,
creates a temporary Git repository, verifies the finding location, and cleans up.
The first implementation passes 10 backend tests, 4 extension tests, lint/type checks,
this live smoke test and VSIX packaging. Interactive editor rendering remains unverified.

## Privacy and confidence

Only selected Git diffs are sent, with up to three context lines per hunk, a 500 KB total
diff budget and a 100-file server cap. Source can contain sensitive information: review
the configured backend destination. Pre-upload secret redaction is not implemented yet.
The service does not persist source or diffs, and validation errors omit submitted input.
Normal review logs contain identifiers, counts and timing only. Findings live in extension
memory and clear when editor content changes. Nothing executes repository code.

Mock confidence is a fixed demo score, not a calibrated probability or completed evidence
aggregation. Mock findings are never labelled confirmed.

## Credentials for later milestones

No credentials are needed now. Bedrock will use the standard AWS credential chain and
configurable `AWS_REGION` and `BEDROCK_MODEL_ID`. AWS deployment will require account/region,
resource permissions and an HTTPS/domain decision. Do not paste credentials into chat.

## Reference documentation

- [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)
