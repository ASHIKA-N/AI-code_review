import * as vscode from "vscode";
import { ApiClient, validateBackendUrl } from "./api";
import { GitService, ReviewMode, safeFile } from "./git";
import { Finding, Review } from "./models";
import { FindingsTree } from "./sidebar";
import { registerEditorPanel } from "./editorPanel";

export function activate(context: vscode.ExtensionContext): void {
  registerEditorPanel(context);
  const output = vscode.window.createOutputChannel("VeriReview");
  const diagnostics = vscode.languages.createDiagnosticCollection("VeriReview");
  const tree = new FindingsTree();
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.text = "$(shield) VeriReview: Ready";
  status.command = "verireview.summary";
  status.show();
  context.subscriptions.push(
    output,
    diagnostics,
    tree,
    status,
    vscode.window.registerTreeDataProvider("verireview.findings", tree),
  );
  let current: Review | undefined;
  let root = "";
  let running = false;
  let generation = 0;
  const clear = (): void => {
    generation++;
    current = undefined;
    diagnostics.clear();
    tree.setReview();
    status.text = "$(shield) VeriReview: Ready";
  };
  const config = () => vscode.workspace.getConfiguration("verireview");
  const api = async () =>
    new ApiClient(
      config().get<string>("backendUrl", "http://127.0.0.1:8000"),
      await context.secrets.get("verireview.apiKey"),
    );
  const register = (
    name: string,
    action: (...args: never[]) => unknown,
  ): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(name, async (...args: never[]) => {
        try {
          await action(...args);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unexpected review error.";
          output.appendLine(message);
          status.text = "$(warning) VeriReview: Error";
          void vscode.window.showErrorMessage(`VeriReview: ${message}`);
        }
      }),
    );
  };
  register("verireview.output", () => output.show());
  register("verireview.clear", () => {
    clear();
    return vscode.commands.executeCommand("verireview.clearGitAi");
  });
  register("verireview.configure", async () => {
    const url = await vscode.window.showInputBox({
      prompt: "Backend URL",
      value: config().get("backendUrl"),
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          validateBackendUrl(value);
          return undefined;
        } catch {
          return "Use HTTPS, or HTTP on localhost.";
        }
      },
    });
    if (url === undefined) return;
    await config().update("backendUrl", url, vscode.ConfigurationTarget.Global);
    const key = await vscode.window.showInputBox({
      prompt: "API key (blank clears the saved key)",
      password: true,
      ignoreFocusOut: true,
    });
    if (key !== undefined) {
      if (key) await context.secrets.store("verireview.apiKey", key);
      else await context.secrets.delete("verireview.apiKey");
    }
    const health = await (await api()).health();
    void vscode.window.showInformationMessage(
      `Connected to VeriReview ${health.version} · ${health.ai_provider} mode`,
    );
  });
  register("verireview.health", async () => {
    const health = await (await api()).health();
    void vscode.window.showInformationMessage(
      `VeriReview ${health.version}: ${health.status} · ${health.ai_provider}`,
    );
  });
  register("verireview.summary", async () => {
    if (!current) {
      void vscode.window.showInformationMessage(
        "No current review. Run VeriReview: Review My Changes.",
      );
      return;
    }
    output.appendLine(
      `Review ${current.review_id}: ${current.files_reviewed}/${current.coverage.submitted_files} submitted files analyzed, ${current.findings.length} findings, ${current.duration_ms} ms, provider=${current.provider}`,
    );
    current.warnings.forEach((w) => output.appendLine(w));
    output.show();
  });
  register("verireview.openFinding", async (finding: Finding) => {
    if (!current?.findings.includes(finding)) return;
    const uri = vscode.Uri.file(await safeFile(root, finding.file_path));
    const document = await vscode.workspace.openTextDocument(uri);
    const line = Math.min(finding.start_line - 1, document.lineCount - 1);
    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(line, 0, line, 0),
    });
    const text = [
      finding.title,
      `${finding.severity} · ${finding.category}`,
      `Confidence score: ${Math.round(finding.confidence * 100)}% (not a probability)`,
      `Verification: ${finding.verification_status}`,
      "",
      finding.description,
      "",
      "Why it matters",
      finding.why_it_matters,
      "",
      "Evidence",
      ...finding.evidence.map(
        (e) => `${e.type} (${e.source}): ${e.description}`,
      ),
      "",
      "Suggestion",
      finding.suggestion,
    ].join("\n");
    const details = await vscode.workspace.openTextDocument({
      content: text,
      language: "plaintext",
    });
    await vscode.window.showTextDocument(details, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
      preserveFocus: true,
    });
  });
  async function review(mode: ReviewMode): Promise<void> {
    if (running) {
      void vscode.window.showInformationMessage("A review is already running.");
      return;
    }
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before running Git review.");
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
      throw new Error("Open a Git repository folder first.");
    const active = vscode.window.activeTextEditor?.document;
    const folder = active
      ? (vscode.workspace.getWorkspaceFolder(active.uri) ?? folders[0])
      : folders[0];
    if (!folder || folder.uri.scheme !== "file")
      throw new Error("Review requires a local filesystem workspace.");
    if (
      vscode.workspace.textDocuments.some(
        (d) =>
          d.isDirty &&
          vscode.workspace.getWorkspaceFolder(d.uri)?.uri.toString() ===
            folder.uri.toString(),
      )
    ) {
      throw new Error(
        "Save your changes before reviewing; Git reviews files on disk.",
      );
    }
    running = true;
    clear();
    const epoch = generation;
    status.text = "$(sync~spin) VeriReview: Reviewing…";
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "VeriReview",
          cancellable: true,
        },
        async (progress, token) => {
          const abort = new AbortController();
          const cancellation = token.onCancellationRequested(() =>
            abort.abort(),
          );
          try {
            progress.report({ message: "Analyzing Git changes" });
            const collected = await new GitService(folder.uri.fsPath).collect(
              mode,
              config().get("baseBranch", ""),
              config().get("maxChangedFiles", 50),
              active?.uri.fsPath,
            );
            collected.warnings.forEach((w) => output.appendLine(w));
            if (!collected.request.files.length) {
              void vscode.window.showInformationMessage(
                "No reviewable changes. See VeriReview output for any skipped files.",
              );
              return;
            }
            if (token.isCancellationRequested) return;
            collected.request.minimum_confidence = config().get(
              "showLowConfidence",
              false,
            )
              ? 0
              : config().get("minimumConfidence", 0.7);
            progress.report({ message: "Waiting for backend review" });
            const response = await (
              await api()
            ).review(collected.request, abort.signal);
            if (generation !== epoch || token.isCancellationRequested) return;
            root = collected.root;
            const entries: [vscode.Uri, vscode.Diagnostic[]][] = [];
            for (const file of collected.request.files) {
              const matching = response.findings.filter(
                (f) => f.file_path === file.path,
              );
              if (!matching.length) continue;
              const uri = vscode.Uri.file(await safeFile(root, file.path));
              const document = await vscode.workspace.openTextDocument(uri);
              const mapped = matching
                .filter(
                  (f) =>
                    f.start_line <= document.lineCount &&
                    f.end_line >= f.start_line,
                )
                .map((f) => {
                  const severity =
                    f.severity === "CRITICAL" || f.severity === "HIGH"
                      ? vscode.DiagnosticSeverity.Error
                      : f.severity === "MEDIUM"
                        ? vscode.DiagnosticSeverity.Warning
                        : vscode.DiagnosticSeverity.Information;
                  const range = new vscode.Range(
                    f.start_line - 1,
                    0,
                    Math.min(f.end_line - 1, document.lineCount - 1),
                    1000,
                  );
                  const diagnostic = new vscode.Diagnostic(
                    range,
                    `${f.title}\n${f.suggestion} (${Math.round(f.confidence * 100)}% confidence score)`,
                    severity,
                  );
                  diagnostic.source = `VeriReview (${response.provider})`;
                  diagnostic.code = f.rule_id;
                  return diagnostic;
                });
              entries.push([uri, mapped]);
            }
            if (generation !== epoch) return;
            current = response;
            current.warnings.push(...collected.warnings);
            diagnostics.set(entries);
            tree.setReview(current);
            response.warnings.forEach((w) => output.appendLine(w));
            output.appendLine(
              `Review completed: ${response.files_reviewed} files, ${response.findings.length} findings.`,
            );
          } finally {
            cancellation.dispose();
          }
        },
      );
    } finally {
      running = false;
      status.text = `$(shield) VeriReview: ${current ? `${current.findings.length} Issues` : "Ready"}`;
    }
  }
  register("verireview.reviewChanges", () =>
    vscode.commands.executeCommand("verireview.aiGit", "working"),
  );
  register("verireview.reviewStaged", () =>
    vscode.commands.executeCommand("verireview.aiGit", "staged"),
  );
  register("verireview.reviewBranch", () =>
    vscode.commands.executeCommand("verireview.aiGit", "branch"),
  );
  register("verireview.reviewFile", () =>
    vscode.commands.executeCommand("verireview.aiGit", "file"),
  );
  register("verireview.reviewBackend", () => review("working"));
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme === "file" && event.contentChanges.length)
        clear();
    }),
  );
}
