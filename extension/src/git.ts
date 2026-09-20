import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { realpath } from "node:fs/promises";
import { ReviewRequest } from "./models";

const exec = promisify(execFile);
export type ReviewMode = "working" | "staged" | "branch" | "file";

export function safeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !/^[\/\\]/.test(value) &&
    !/[\\:\x00-\x1f]/.test(value) &&
    value.split("/").every((p) => p !== ".." && p !== "." && p !== "")
  );
}

export async function safeFile(
  root: string,
  relative: string,
): Promise<string> {
  if (!safeRelativePath(relative)) throw new Error("Unsafe finding path.");
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(path.join(root, relative));
  const relation = path.relative(resolvedRoot, resolved);
  if (
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    throw new Error("File resolves outside the repository.");
  }
  return resolved;
}

export class GitService {
  constructor(private readonly cwd: string) {}
  async snapshot(file: string, mode: "staged" | "branch"): Promise<string> {
    if (!safeRelativePath(file)) throw new Error("Unsafe snapshot path.");
    return this.git(["show", mode === "staged" ? `:${file}` : `HEAD:${file}`]);
  }
  private async git(args: string[]): Promise<string> {
    try {
      const { stdout } = await exec(
        "git",
        ["--literal-pathspecs", "-c", "core.quotepath=false", ...args],
        {
          cwd: this.cwd,
          encoding: "utf8",
          timeout: 15_000,
          maxBuffer: 2_000_000,
        },
      );
      return stdout;
    } catch {
      throw new Error(
        "Git command failed. Check repository, base branch and diff size.",
      );
    }
  }
  async collect(
    mode: ReviewMode,
    baseBranch: string,
    maximum: number,
    activeFile?: string,
  ): Promise<{ root: string; request: ReviewRequest; warnings: string[] }> {
    const root = (await this.git(["rev-parse", "--show-toplevel"])).trim();
    const branch =
      (await this.git(["branch", "--show-current"])).trim() ||
      "HEAD (detached)";
    let revisions: string[];
    if (mode === "branch") {
      let base = baseBranch;
      if (!base) {
        try {
          base = (
            await this.git([
              "symbolic-ref",
              "--short",
              "refs/remotes/origin/HEAD",
            ])
          ).trim();
        } catch {
          base = "main";
        }
      }
      if (base.startsWith("-") || /[\x00-\x20]/.test(base))
        throw new Error("Invalid base branch.");
      const hash = (
        await this.git([
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${base}^{commit}`,
        ])
      ).trim();
      revisions = [`${hash}...HEAD`];
    } else if (mode === "staged") {
      revisions = ["--cached"];
    } else {
      try {
        await this.git(["rev-parse", "--verify", "HEAD"]);
        revisions = ["HEAD"];
      } catch {
        throw new Error(
          "Working review needs an initial commit. Stage files and use Review Staged Changes.",
        );
      }
    }
    const filters: string[] = [];
    if (mode === "file") {
      if (!activeFile) throw new Error("Open a source file first.");
      const relative = path
        .relative(root, activeFile)
        .split(path.sep)
        .join("/");
      if (!safeRelativePath(relative))
        throw new Error("Current file is outside this repository.");
      filters.push(relative);
    }
    const common = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      ...revisions,
    ];
    const names = (
      await this.git([
        ...common,
        "--name-only",
        "-z",
        "--diff-filter=ACMT",
        "--",
        ...filters,
      ])
    )
      .split("\0")
      .filter(Boolean);
    const files: ReviewRequest["files"] = [];
    const warnings: string[] = [];
    let bytes = 0;
    for (const name of names) {
      if (!safeRelativePath(name)) {
        warnings.push("Skipped a file with an unsupported path.");
        continue;
      }
      if (
        /(^|\/)(node_modules|vendor|dist|build)\/|\.(lock|min\.js|svg|png|jpg)$|(^|\/)package-lock\.json$/.test(
          name,
        )
      ) {
        warnings.push(`Skipped generated or binary candidate: ${name}`);
        continue;
      }
      if (files.length >= maximum) {
        warnings.push(`File budget: skipped ${name}`);
        continue;
      }
      // Use Git's index/commit blobs, never follow working-tree symlinks to collect contents.
      const diff = await this.git([...common, "--unified=3", "--", name]);
      if (!diff.includes("\n@@ ")) {
        warnings.push(`No text hunks: ${name}`);
        continue;
      }
      const size = Buffer.byteLength(diff);
      if (size > 200_000 || bytes + size > 500_000) {
        warnings.push(`Diff budget: skipped ${name}`);
        continue;
      }
      bytes += size;
      files.push({ path: name, diff });
    }
    if (mode === "working" || mode === "file") {
      const untracked = await this.git([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...filters,
      ]);
      if (untracked)
        warnings.push(
          "Untracked files are not reviewed. Stage them to include them.",
        );
    }
    return {
      root,
      request: {
        repository: path.basename(root),
        branch,
        files,
        minimum_confidence: 0.7,
        max_findings: 10,
      },
      warnings,
    };
  }
}
