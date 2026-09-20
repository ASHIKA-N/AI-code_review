import * as vscode from "vscode";
import { GitService, ReviewMode, safeFile } from "./git";
import { reviewEditor, Settings, EditorFinding } from "./editorAi";
import { addedLineMap } from "./diffLines";

// Provider line numbers refer to the submitted patch. Only added lines can become diagnostics.

export function registerGitAi(
  context: vscode.ExtensionContext,
  getSettings: () => Settings,
  report: (text: string) => void,
): void {
  const diagnostics =
    vscode.languages.createDiagnosticCollection("VeriReview AI Git");
  const output = vscode.window.createOutputChannel("VeriReview AI Git");
  let running = false;
  let generation = 0;
  let controller: AbortController | undefined;
  const clear = () => {
    generation++;
    controller?.abort();
    diagnostics.clear();
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(
    diagnostics,
    output,
    watcher,
    vscode.commands.registerCommand("verireview.cancelGitAi", () =>
      controller?.abort(),
    ),
    vscode.commands.registerCommand("verireview.clearGitAi", clear),
    watcher.onDidChange(clear),
    watcher.onDidCreate(clear),
    watcher.onDidDelete(clear),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length && e.document.uri.scheme === "file") clear();
    }),
    new vscode.Disposable(() => controller?.abort()),
    vscode.commands.registerCommand(
      "verireview.aiGit",
      async (mode: ReviewMode = "working") => {
        if (running) {
          report("A Git AI review is already running.");
          return;
        }
        running = true;
        try {
          if (!vscode.workspace.isTrusted)
            throw new Error("Trust this workspace before reviewing.");
          if (!["working", "staged", "branch", "file"].includes(mode))
            throw new Error("Invalid Git review scope.");
          const settings = getSettings();
          const key = await context.secrets.get(
            `verireview.provider.${settings.provider}`,
          );
          if (!key)
            throw new Error("Connect your AI key in the checklist first.");
          const active = vscode.window.activeTextEditor?.document;
          const folder =
            (active && vscode.workspace.getWorkspaceFolder(active.uri)) ||
            vscode.workspace.workspaceFolders?.[0];
          if (!folder || folder.uri.scheme !== "file")
            throw new Error("Open a local Git repository first.");
          if (
            vscode.workspace.textDocuments.some(
              (d) =>
                d.isDirty &&
                vscode.workspace.getWorkspaceFolder(d.uri) === folder,
            )
          )
            throw new Error("Save your files before reviewing Git changes.");
          clear();
          controller = new AbortController();
          const abort = controller;
          const epoch = generation;
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "VeriReview Git AI",
              cancellable: true,
            },
            async (progress, token) => {
              const cancellation = token.onCancellationRequested(() =>
                abort.abort(),
              );
              try {
                const config = vscode.workspace.getConfiguration("verireview");
                const git = new GitService(folder.uri.fsPath);
                const collect = () =>
                  git.collect(
                    mode,
                    config.get("baseBranch", ""),
                    config.get("maxChangedFiles", 50),
                    active?.uri.fsPath,
                  );
                const input = await collect();
                output.clear();
                input.warnings.forEach((w) => output.appendLine(w));
                if (!input.request.files.length) {
                  report(
                    "No reviewable Git changes. See VeriReview AI Git output for skipped files.",
                  );
                  output.show(true);
                  return;
                }
                const snapshots: {
                  document: vscode.TextDocument;
                  version: number;
                  diff: string;
                  path: string;
                }[] = [];
                for (const file of input.request.files) {
                  const document = await vscode.workspace.openTextDocument(
                    vscode.Uri.file(await safeFile(input.root, file.path)),
                  );
                  if (document.isDirty)
                    throw new Error("Save all reviewed files first.");
                  if (mode === "staged" || mode === "branch") {
                    const snapshot = await git.snapshot(file.path, mode);
                    if (
                      snapshot.replace(/\r\n/g, "\n") !==
                      document.getText().replace(/\r\n/g, "\n")
                    )
                      throw new Error(
                        `Working file differs from the reviewed Git snapshot: ${file.path}. Use Git Changes or restore matching contents before reviewing this scope.`,
                      );
                  }
                  if (Buffer.byteLength(file.diff) > 100_000) {
                    output.appendLine(
                      `Skipped ${file.path}: AI request exceeds 100 KB.`,
                    );
                    continue;
                  }
                  snapshots.push({
                    document,
                    version: document.version,
                    diff: file.diff,
                    path: file.path,
                  });
                }
                const entries: [vscode.Uri, vscode.Diagnostic[]][] = [];
                let count = 0;
                for (const snapshot of snapshots) {
                  if (abort.signal.aborted) return;
                  progress.report({
                    message: `${snapshot.path} (${settings.provider})`,
                  });
                  const map = addedLineMap(snapshot.diff);
                  if (!map.size) {
                    output.appendLine(
                      `Skipped ${snapshot.path}: no added lines.`,
                    );
                    continue;
                  }
                  const findings = await reviewEditor(
                    settings,
                    key,
                    snapshot.diff,
                    "unified Git diff. Review added (+) lines only. Return line as the 1-based line in this submitted diff, NOT the source hunk number",
                    abort.signal,
                  );
                  const mapped = findings.flatMap((f: EditorFinding) => {
                    const line = map.get(f.line);
                    if (!line || line > snapshot.document.lineCount) return [];
                    const diagnostic = new vscode.Diagnostic(
                      snapshot.document.lineAt(line - 1).range,
                      `${f.title}\n${f.explanation}\nSuggestion: ${f.suggestion}\nAI suggestion; not independently verified.`,
                      vscode.DiagnosticSeverity.Warning,
                    );
                    diagnostic.source = `VeriReview Git (${settings.provider})`;
                    diagnostic.code = f.check;
                    output.appendLine(
                      `${snapshot.path}:${line} ${f.title}\n${f.explanation}\n${f.suggestion}`,
                    );
                    return [diagnostic];
                  });
                  count += mapped.length;
                  entries.push([snapshot.document.uri, mapped]);
                }
                const current = await collect();
                if (
                  abort.signal.aborted ||
                  epoch !== generation ||
                  snapshots.some(
                    (s) =>
                      s.document.version !== s.version || s.document.isDirty,
                  ) ||
                  JSON.stringify(current.request.files) !==
                    JSON.stringify(input.request.files)
                ) {
                  report(
                    "Git changes changed during review. Run review again.",
                  );
                  return;
                }
                diagnostics.set(entries);
                output.show(true);
                report(
                  `Git AI review complete: ${count} findings. Open Problems for file and line navigation. See output for skipped files. No findings does not guarantee correctness.`,
                );
              } finally {
                cancellation.dispose();
              }
            },
          );
        } catch (error) {
          const text =
            error instanceof Error ? error.message : "Git AI review failed.";
          report(text);
          void vscode.window.showErrorMessage(text);
        } finally {
          running = false;
          controller = undefined;
        }
      },
    ),
  );
}
