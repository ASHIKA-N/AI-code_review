# VeriReview AI

**Evidence-Based AI Code Review for Developers** — Review before the reviewer.

VeriReview is being built as a VS Code extension backed by FastAPI. It reviews Git changes
before human review, with structured findings, evidence and confidence scores.

## Current implementation

The extension also includes a **bring-your-own-key AI checklist** for the current editor.
It opens automatically at startup, or via **VeriReview: Open AI Checklist**.
Paste your API key and click **Connect**. Recognized OpenAI project/service-account,
Anthropic Claude, xAI Grok, and Groq (`gsk_`) key formats are detected locally. The extension checks
that provider's model list and automatically chooses an available model from its supported
review models. No provider or model entry is required. Unknown/ambiguous key formats are
rejected without sending them anywhere. For other services, expand **Custom connection**
and enter the API base URL and model ID along with your key. Custom mode supports
OpenAI-compatible Chat Completions with Bearer authentication, not every AI API format.
Remote URLs require HTTPS; HTTP is allowed only for loopback services. Custom credentials
are saved without a network check; access is validated on the first review. The destination
is shown in the panel before you send code. Close Custom connection to restore auto-detection.
Turn on only the checklist toggles you need, open a source file, and click **Review code**.

Under **Your custom checks**, describe a rule and click **Add check**. Custom checks
have their own toggles and Remove buttons; they persist across sessions. You can save
up to 20 rules of 500 characters each and run a review using only custom checks if desired.
Only enabled rules are sent to the AI. These are review instructions, not executable tests.

This mode sends the full current editor contents (including unsaved edits, up to 100 KB)
directly to the selected provider from the extension host. It needs no FastAPI server.
API usage is billed by your provider. Keys are stored separately in VS Code SecretStorage;
they are never saved in project settings or sent to the VeriReview backend. The saved-key
indicator confirms access to the model list, not inference quota or billing. Review calls
can still fail if your account lacks inference access or credits. Existing users should
reconnect their key once to enable automatic model selection.

Checklist selections persist. Findings appear in the checklist panel and Problems panel,
with clickable line navigation. Editing reviewed code clears obsolete findings. These are
AI suggestions, not verified static-analysis results; no fixes are applied automatically.
Turn off `verireview.showChecklistOnStartup` to stop opening the panel automatically.
The Git commands now use the same saved AI connection and enabled checklist, including
custom rules. Choose **Git changes**, **Staged changes**, **Current branch**, or
**Current file Git changes** in the panel, or run the corresponding Command Palette command.
Save files before Git review. Git review sends bounded diffs, one request per eligible file,
and maps findings only to added lines. Results appear in Problems with file navigation and
in **VeriReview AI Git** Output with explanations and suggestions. Skipped files are listed
in Output. Cancellation is available in the panel and progress notification.
Staged/branch reviews require working files to match the index/HEAD snapshot to avoid
misplaced diagnostics. Editor/file changes clear Git diagnostics; results are discarded if
the collected diff changes during review. Pure deletions have no added lines to annotate.

The original FastAPI/mock flow remains available through **VeriReview: Review My Changes
with Backend (Legacy)**; only that workflow requires the backend server and uses the old
severity-grouped findings tree. The sample mock demo below applies to this legacy command.

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

For backend Git review, only selected Git diffs are sent, with up to three context lines per hunk, a 500 KB total
diff budget and a 100-file server cap. Source can contain sensitive information: review
the configured backend destination. Pre-upload secret redaction is not implemented yet.
The service does not persist source or diffs, and validation errors omit submitted input.
Normal review logs contain identifiers, counts and timing only. Findings live in extension
memory and clear when editor content changes. Nothing executes repository code.

Mock confidence is a fixed demo score, not a calibrated probability or completed evidence
aggregation. Mock findings are never labelled confirmed.

## Credentials for later milestones

No credentials are needed for mock backend review. Editor AI review requires the user's
selected provider API key. Bedrock will use the standard AWS credential chain and
configurable `AWS_REGION` and `BEDROCK_MODEL_ID`. AWS deployment will require account/region,
resource permissions and an HTTPS/domain decision. Do not paste credentials into chat.

## Reference documentation

- [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)
