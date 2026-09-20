# VeriReview AI

**Evidence-Based AI Code Review for Developers** — Review before the reviewer.

VeriReview AI is a VS Code extension backed by FastAPI that reviews Git changes before
human review. It provides structured findings, supporting evidence, confidence scores,
severity information, and clickable navigation to the relevant code.

---

# Hackathon Write-up

## Problem

Code review is an important part of software development, but manually reviewing every
change can be time-consuming and potential issues can be missed before code reaches a
human reviewer.

Developers need a way to perform an initial review of their changes before submitting
them for human review, while still being able to understand why a piece of code was
flagged.

## Solution

VeriReview AI is an evidence-based AI code review tool built as a VS Code extension.
It reviews code changes before human review and presents structured findings directly
inside the developer's editor.

The system can identify potential issues, provide supporting evidence and confidence
information, and allow developers to navigate directly to the relevant lines of code.

The extension also supports custom review rules, allowing developers to describe
project-specific checks in addition to the built-in review checklist.

## How It Works

VeriReview AI provides multiple ways to review code:

- **Git Changes** — reviews changes between the working tree and HEAD.
- **Staged Changes** — reviews changes currently staged in Git.
- **Current Branch** — reviews changes relative to the configured base branch.
- **Current File Git Changes** — reviews Git changes affecting the current file.
- **Current Editor Review** — reviews the contents of the currently open editor.

For AI-powered review, users can connect their own AI provider using a
**Bring Your Own Key (BYOK)** approach. The extension detects supported provider key
formats locally and automatically selects an available supported model where possible.
Custom OpenAI-compatible providers can also be configured.

The extension displays review findings in the VS Code Problems panel and VeriReview
panels, with clickable navigation to the relevant source lines.

## Technology Stack

- **VS Code Extension:** TypeScript
- **Backend:** Python, FastAPI
- **Validation:** Zod, Pydantic
- **Testing:** Pytest, npm test
- **Version Control:** Git
- **AI Integration:** Provider-agnostic BYOK architecture
- **Containerization:** Docker / Docker Compose

## AI Coding Tools Used

**OpenAI Codex** was used during development to assist with code generation,
implementation, debugging, and iterative refinement.

The team reviewed the generated code and integrated the relevant implementation into
the project rather than treating AI-generated output as automatically verified code.

## AWS Usage

The project was designed with future AWS integration in mind, including Amazon Bedrock
and AWS-based deployment infrastructure.

However, due to the unavailability of AWS credits during development, the submitted
implementation was developed and tested locally and does **not currently use a
deployed AWS service**.

The architecture was kept provider-agnostic so that AWS services such as Amazon
Bedrock can be integrated as a subsequent milestone without requiring a redesign of
the core review workflow.

Planned AWS-related milestones include Bedrock integration and AWS-based deployment.

## Current Status

The submitted implementation includes:

- Four Git review modes
- AI-assisted editor review
- Bring-your-own-key provider connections
- Automatic supported-model selection
- Custom review checks
- Runtime-validated HTTP communication
- FastAPI health and review endpoints
- Deterministic mock reviewer for local development
- VS Code Problems-panel diagnostics
- Severity-grouped findings
- Finding navigation
- Evidence details
- Review cancellation and progress reporting
- Bounded request sizes
- Secure credential storage through VS Code SecretStorage

The current implementation is an early working slice rather than the completed
long-term product.

Planned subsequent milestones include:

- Amazon Bedrock integration
- Semgrep execution
- Repository context
- Team-specific rules
- Suggested fixes
- Feedback storage
- Pull-request integration
- AWS infrastructure and deployment
- Isolated verification of findings

---

# Demo

**Demo Video:**  
https://youtu.be/sBno64MxG2Y?si=BjJCryguhJ3ndb1z

---

# Current Implementation

The extension includes a **bring-your-own-key AI checklist** for the current editor.
It opens automatically at startup, or via **VeriReview: Open AI Checklist**.

Paste your API key and click **Connect**. Recognized OpenAI project/service-account,
Anthropic Claude, xAI Grok, and Groq (`gsk_`) key formats are detected locally. The
extension checks that provider's model list and automatically chooses an available
model from its supported review models.

No provider or model entry is required for supported providers. Unknown or ambiguous
key formats are rejected without sending them anywhere.

For other services, expand **Custom connection** and enter the API base URL and model ID
along with your key. Custom mode supports OpenAI-compatible Chat Completions with
Bearer authentication, not every AI API format.

Remote URLs require HTTPS; HTTP is allowed only for loopback services. Custom
credentials are saved without a network check; access is validated on the first
review. The destination is shown in the panel before you send code.

Close Custom connection to restore auto-detection. Turn on only the checklist toggles
you need, open a source file, and click **Review code**.

## Custom Checks

Under **Your custom checks**, describe a rule and click **Add check**.

Custom checks have their own toggles and Remove buttons; they persist across sessions.
You can save up to 20 rules of 500 characters each and run a review using only custom
checks if desired.

Only enabled rules are sent to the AI. These are review instructions, not executable
tests.

## AI Review and Privacy

The current editor review sends the full current editor contents, including unsaved
edits, up to 100 KB, directly to the selected provider from the extension host.

It does not require the FastAPI server.

API usage is billed by the selected provider. Keys are stored separately in VS Code
SecretStorage; they are never saved in project settings or sent to the VeriReview
backend.

The saved-key indicator confirms access to the model list, not inference quota or
billing. Review calls can still fail if the user's account lacks inference access or
credits.

Existing users should reconnect their key once to enable automatic model selection.

## Findings

Checklist selections persist.

Findings appear in the checklist panel and Problems panel, with clickable line
navigation.

Editing reviewed code clears obsolete findings.

These are AI suggestions, not verified static-analysis results. No fixes are applied
automatically.

Turn off `verireview.showChecklistOnStartup` to stop opening the panel automatically.

## Git Review

The Git commands use the same saved AI connection and enabled checklist, including
custom rules.

Choose:

- **Git changes**
- **Staged changes**
- **Current branch**
- **Current file Git changes**

from the panel, or run the corresponding Command Palette command.

Save files before Git review.

Git review sends bounded diffs, one request per eligible file, and maps findings only
to added lines.

Results appear in Problems with file navigation and in **VeriReview AI Git** Output
with explanations and suggestions.

Skipped files are listed in Output.

Cancellation is available in the panel and progress notification.

Staged and branch reviews require working files to match the index/HEAD snapshot to
avoid misplaced diagnostics.

Editor/file changes clear Git diagnostics; results are discarded if the collected diff
changes during review.

Pure deletions have no added lines to annotate.

## Legacy Backend Workflow

The original FastAPI/mock flow remains available through:

**VeriReview: Review My Changes with Backend (Legacy)**

Only this workflow requires the backend server and uses the old severity-grouped
findings tree.

The sample mock demo below applies to this legacy command.

The first local slice includes:

- Four Git review modes
- Runtime-validated HTTP client
- FastAPI health and review endpoints
- Deterministic mock reviewer
- Problems-panel diagnostics
- Severity-grouped sidebar
- Finding navigation
- Evidence details

Requests have bounded sizes; remote backends require HTTPS; API keys use VS Code
SecretStorage.

The mock reviewer only recognizes credential-like literal assignments. It does not
call an AI model.

See [the implementation plan](docs/implementation-plan.md) for the full sequence.

---

# Start Locally

Requires:

- Python 3.12+
- Node.js 22+
- Git
- VS Code

## Backend

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e './backend[dev]'
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Extension

In a second terminal:

```powershell
cd extension
npm ci
npm run compile
```

Open the project root in VS Code and press **F5**, selecting:

**Run VeriReview Extension**

In the development host, open a Git repository and run:

**VeriReview: Check Backend Connection**

Save changed files, then run:

**VeriReview: Review My Changes**

The [sample project](examples/sample-project/README.md) provides a reproducible mock
finding.

Other modes:

- **Review Staged Changes**
- **Review Current Branch**
- **Review Current File**

Working mode compares HEAD with the working tree, including staged changes.

Staged mode uses the index.

Branch mode compares the configured base's merge base with HEAD.

Untracked files must be staged.

Deletions and renames are not yet represented as rich change records; rename additions
are reviewed as new paths.

Generated/binary candidates and files beyond budgets are reported in the output
channel.

Staged/branch finding locations describe their reviewed Git snapshot. If your working
tree differs, editor positions can differ.

Use a clean working tree for those modes until snapshot-aware navigation is
implemented.

## Backend Configuration

The backend defaults to unauthenticated mock mode for loopback development.

Set `VERIREVIEW_API_KEY` in your environment or root `.env` and use **Configure
Backend** to save the matching key in SecretStorage.

`APP_ENV=production` requires a key.

Interactive API docs:

[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

Health:

[http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health)

---

# Docker

With Docker installed:

```powershell
docker compose up --build
```

The port binds only to loopback.

The image runs as a non-root user.

Docker builds have not yet been verified on the initial development machine because
Docker is not installed.

Semgrep is not yet included.

---

# Validation

Run the backend tests:

```powershell
.\.venv\Scripts\python -m pytest backend/tests
```

Run Ruff:

```powershell
.\.venv\Scripts\python -m ruff check backend
```

Run mypy:

```powershell
.\.venv\Scripts\python -m mypy backend/app
```

Export the API contract:

```powershell
.\.venv\Scripts\python scripts/export_contract.py
```

Run extension checks:

```powershell
cd extension
npm run lint
npm test
npm run package
```

`contracts/openapi.json` is exported from Pydantic.

The extension validates backend responses with Zod.

Packaging is local only; nothing is published to the Marketplace.

After compiling the extension, run:

```powershell
node scripts/smoke.cjs
```

from the root for a live Git → extension client → backend check.

It starts a temporary backend on port 18764, creates a temporary Git repository,
verifies the finding location, and cleans up.

The first implementation passes:

- 10 backend tests
- 4 extension tests
- Lint checks
- Type checks
- Live smoke test
- VSIX packaging

Interactive editor rendering remains unverified.

---

# Privacy and Confidence

For backend Git review, only selected Git diffs are sent, with up to three context
lines per hunk, a 500 KB total diff budget and a 100-file server cap.

Source can contain sensitive information: review the configured backend destination.

Pre-upload secret redaction is not implemented yet.

The service does not persist source or diffs, and validation errors omit submitted
input.

Normal review logs contain identifiers, counts and timing only.

Findings live in extension memory and clear when editor content changes.

Nothing executes repository code.

Mock confidence is a fixed demo score, not a calibrated probability or completed
evidence aggregation.

Mock findings are never labelled confirmed.

---

# Credentials for Later Milestones

No credentials are needed for mock backend review.

Editor AI review requires the user's selected provider API key.

Future Bedrock integration will use the standard AWS credential chain and configurable:

- `AWS_REGION`
- `BEDROCK_MODEL_ID`

AWS deployment will require an AWS account/region, appropriate resource permissions,
and an HTTPS/domain decision.

Do not commit credentials to the repository.

---

# Reference Documentation

- [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [FastAPI Testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [Implementation Plan](docs/implementation-plan.md)
