import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { connectKey, Connection, customConnection } from "./aiConnection";
import { checklistHtml } from "./checklistView";
import { registerGitAi } from "./gitAi";
import {
  EditorFinding,
  reviewEditor,
  Settings,
  settingsSchema,
  checklistPreferencesSchema,
  checks,
} from "./editorAi";

export function registerEditorPanel(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  let target = vscode.window.activeTextEditor?.document;
  let abort: AbortController | undefined;
  let findings: EditorFinding[] = [];
  let reviewed: vscode.TextDocument | undefined;
  let reviewedVersion = 0;
  let connecting = false;
  const connection = () =>
    context.globalState.get<Connection>("verireview.connection");
  const sendConnection = async () => {
    const saved = connection();
    send({
      type: "connection",
      connection:
        saved &&
        (await context.secrets.get(`verireview.provider.${saved.provider}`))
          ? saved
          : undefined,
    });
  };
  const diagnostics = vscode.languages.createDiagnosticCollection(
    "VeriReview AI Checklist",
  );
  const send = (message: object) => {
    void panel?.webview.postMessage(message);
  };
  registerGitAi(
    context,
    () => {
      const preferences = checklistPreferencesSchema.parse(
        context.globalState.get("verireview.editorSettings", {
          checks: Object.keys(checks),
        }),
      );
      const parsed = settingsSchema.safeParse({
        ...connection(),
        ...preferences,
      });
      if (!parsed.success)
        throw new Error(
          "Connect your AI and select checks in VeriReview: Open AI Checklist first.",
        );
      return parsed.data;
    },
    (text) => send({ type: "status", text }),
  );
  const invalidate = () => {
    abort?.abort();
    findings = [];
    reviewed = undefined;
    diagnostics.clear();
    send({ type: "results", findings: [] });
  };
  context.subscriptions.push(
    diagnostics,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && ["file", "untitled"].includes(editor.document.uri.scheme)) {
        target = editor.document;
        send({
          type: "target",
          name: vscode.workspace.asRelativePath(target.uri),
        });
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        event.contentChanges.length &&
        (event.document === reviewed || event.document === target)
      ) {
        invalidate();
        send({ type: "status", text: "Code changed. Run a new review." });
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document === target) target = undefined;
      if (document === reviewed) invalidate();
    }),
    vscode.commands.registerCommand("verireview.openChecklist", () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.Beside, true);
        return;
      }
      panel = vscode.window.createWebviewPanel(
        "verireview.checklist",
        "VeriReview Checklist",
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [] },
      );
      const nonce = randomBytes(24).toString("hex");
      panel.webview.html = checklistHtml(nonce);
      panel.onDidDispose(
        () => {
          abort?.abort();
          panel = undefined;
        },
        undefined,
        context.subscriptions,
      );
      panel.webview.onDidReceiveMessage(
        async (message: unknown) => {
          try {
            if (!message || typeof message !== "object") return;
            const m = message as Record<string, unknown>;
            if (m.type === "ready") {
              send({
                type: "settings",
                settings: context.globalState.get("verireview.editorSettings"),
              });
              send({
                type: "target",
                name: target
                  ? vscode.workspace.asRelativePath(target.uri)
                  : "Open a source file to review",
              });
              await sendConnection();
            } else if (
              m.type === "keyStatus" ||
              m.type === "saveKey" ||
              m.type === "deleteKey"
            ) {
              if (connecting || abort)
                throw new Error("Wait for the current operation to finish.");
              if (m.type === "saveKey") {
                if (
                  typeof m.key !== "string" ||
                  !m.key.trim() ||
                  m.key.length > 4096
                )
                  throw new Error("Enter a valid API key.");
                connecting = true;
                send({ type: "connecting", value: true });
                try {
                  const key = m.key.trim();
                  const detected =
                    m.custom === true
                      ? customConnection(
                          z.string().parse(m.baseUrl),
                          z.string().parse(m.model),
                        )
                      : await connectKey(key, fetch, async (ids) =>
                          vscode.window.showQuickPick(ids, {
                            title: "API key accepted - select a review model",
                            placeHolder:
                              "Choose a text/chat model. Inference compatibility is checked on review.",
                            ignoreFocusOut: true,
                          }),
                        );
                  await context.secrets.store(
                    `verireview.provider.${detected.provider}`,
                    key,
                  );
                  await context.globalState.update(
                    "verireview.connection",
                    detected,
                  );
                  send({
                    type: "status",
                    text: "Connected. Choose your checks and start a review.",
                  });
                } finally {
                  connecting = false;
                  send({ type: "connecting", value: false });
                }
              }
              if (m.type === "deleteKey") {
                const saved = connection();
                if (saved)
                  await context.secrets.delete(
                    `verireview.provider.${saved.provider}`,
                  );
                await context.globalState.update(
                  "verireview.connection",
                  undefined,
                );
              }
              await sendConnection();
            } else if (m.type === "preferences") {
              // Empty checklists are valid preferences, but cannot start a review.
              const prefs = checklistPreferencesSchema.parse(m.settings);
              await context.globalState.update(
                "verireview.editorSettings",
                prefs,
              );
            } else if (m.type === "cancel") {
              abort?.abort();
              await vscode.commands.executeCommand("verireview.cancelGitAi");
            } else if (m.type === "open") {
              if (typeof m.index !== "number" || !Number.isInteger(m.index))
                return;
              const finding = findings[m.index];
              if (
                finding &&
                reviewed &&
                !reviewed.isClosed &&
                reviewed.version === reviewedVersion
              )
                await vscode.window.showTextDocument(reviewed, {
                  selection: new vscode.Range(
                    finding.line - 1,
                    0,
                    finding.line - 1,
                    0,
                  ),
                  viewColumn: vscode.ViewColumn.One,
                });
            } else if (m.type === "review") {
              if (m.scope && m.scope !== "editor") {
                if (abort || connecting)
                  throw new Error("Wait for the current operation to finish.");
                const scope = z
                  .enum(["working", "staged", "branch", "file"])
                  .parse(m.scope);
                await context.globalState.update(
                  "verireview.editorSettings",
                  checklistPreferencesSchema.parse(m.settings),
                );
                send({ type: "busy", value: true });
                try {
                  await vscode.commands.executeCommand(
                    "verireview.aiGit",
                    scope,
                  );
                } finally {
                  send({ type: "busy", value: false });
                }
                return;
              }
              if (abort || connecting)
                throw new Error("Wait for the current operation to finish.");
              if (!vscode.workspace.isTrusted)
                throw new Error(
                  "Trust this workspace before sending code for review.",
                );
              const selected = checklistPreferencesSchema.safeParse(m.settings);
              const parsed = settingsSchema.safeParse({
                ...connection(),
                checks: selected.success ? selected.data.checks : [],
                customChecks: selected.success
                  ? selected.data.customChecks
                  : undefined,
              });
              if (!parsed.success)
                throw new Error(
                  "Connect your API key and select at least one check.",
                );
              const settings: Settings = parsed.data;
              const document = target;
              if (!document || document.isClosed)
                throw new Error("Open a source file before reviewing.");
              const key = await context.secrets.get(
                `verireview.provider.${settings.provider}`,
              );
              if (!key)
                throw new Error(
                  "Save your API key for the selected provider first.",
                );
              await context.globalState.update(
                "verireview.editorSettings",
                settings,
              );
              if (abort) throw new Error("A review is already running.");
              if (document.isClosed)
                throw new Error(
                  "The source file was closed. Open it and try again.",
                );
              invalidate();
              const controller = new AbortController();
              abort = controller;
              reviewed = document;
              reviewedVersion = document.version;
              const version = reviewedVersion;
              send({ type: "busy", value: true });
              send({
                type: "status",
                text: `Reviewing with ${settings.provider}â€¦`,
              });
              try {
                const result = await reviewEditor(
                  settings,
                  key,
                  document.getText(),
                  document.languageId,
                  controller.signal,
                );
                if (
                  controller.signal.aborted ||
                  document.isClosed ||
                  document.version !== version
                )
                  return;
                findings = result;
                diagnostics.set(
                  document.uri,
                  findings.map((f) => {
                    const diagnostic = new vscode.Diagnostic(
                      document.lineAt(f.line - 1).range,
                      `${f.title}\n${f.explanation}\nSuggestion: ${f.suggestion}\nAI suggestion; not independently verified.`,
                      f.severity === "HIGH"
                        ? vscode.DiagnosticSeverity.Warning
                        : vscode.DiagnosticSeverity.Information,
                    );
                    diagnostic.source = `VeriReview AI (${settings.provider})`;
                    diagnostic.code = f.check;
                    return diagnostic;
                  }),
                );
                send({ type: "results", findings });
                send({
                  type: "status",
                  text: `${findings.length} AI findings across ${settings.checks.length} selected checks. No findings does not guarantee correctness.`,
                });
              } finally {
                abort = undefined;
                send({ type: "busy", value: false });
              }
            }
          } catch (error) {
            const text =
              error instanceof Error && !("issues" in error)
                ? error.message
                : "Check your API key and select at least one check.";
            if (
              message &&
              typeof message === "object" &&
              (message as Record<string, unknown>).type === "saveKey"
            ) {
              send({ type: "connectionError", text });
              void vscode.window.showErrorMessage(`VeriReview: ${text}`);
            }
            send({
              type: "status",
              text,
            });
          }
        },
        undefined,
        context.subscriptions,
      );
    }),
    new vscode.Disposable(() => {
      abort?.abort();
      panel?.dispose();
    }),
  );
  if (
    vscode.workspace
      .getConfiguration("verireview")
      .get("showChecklistOnStartup", true)
  )
    void vscode.commands.executeCommand("verireview.openChecklist");
}
