import * as vscode from "vscode";
import { Finding, Review, severitySchema } from "./models";

export class FindingsTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private review?: Review;
  setReview(review?: Review): void {
    this.review = review;
    this.changed.fire();
  }
  dispose(): void {
    this.changed.dispose();
  }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }
  getChildren(item?: vscode.TreeItem): vscode.TreeItem[] {
    if (!this.review)
      return [new vscode.TreeItem("Run Review My Changes to begin")];
    if (!item) {
      const summary = new vscode.TreeItem(
        `${this.review.files_reviewed} files · ${this.review.findings.length} findings · ${this.review.provider}`,
      );
      summary.command = {
        command: "verireview.summary",
        title: "Open summary",
      };
      return [
        summary,
        ...severitySchema.options
          .filter((s) => this.review?.findings.some((f) => f.severity === s))
          .map((s) => {
            const group = new vscode.TreeItem(
              s,
              vscode.TreeItemCollapsibleState.Expanded,
            );
            group.id = s;
            return group;
          }),
      ];
    }
    return this.review.findings
      .filter((f) => f.severity === item.id)
      .map((f: Finding) => {
        const child = new vscode.TreeItem(f.title);
        child.description = `${f.file_path}:${f.start_line} · ${Math.round(f.confidence * 100)}%`;
        child.tooltip = `${f.severity} · ${f.category}\n${f.description}`;
        child.iconPath = new vscode.ThemeIcon(
          f.severity === "HIGH" || f.severity === "CRITICAL"
            ? "error"
            : "warning",
        );
        child.command = {
          command: "verireview.openFinding",
          title: "Open finding",
          arguments: [f],
        };
        return child;
      });
  }
}
