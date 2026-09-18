import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { GitService, safeRelativePath } from "../src/git";

test("safe repository paths", () => {
  for (const invalid of ["../a", "/a", "C:/a", "a\\b", "a/../b"])
    assert.equal(safeRelativePath(invalid), false);
  assert.equal(safeRelativePath("src/file name.py"), true);
});

test("real Git staged, working, branch, current-file and untracked behavior", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verireview-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-b", "main");
    git("config", "user.name", "VeriReview Tests");
    git("config", "user.email", "tests@example.invalid");
    await writeFile(path.join(root, "file name.py"), "value = 1\n");
    git("add", ".");
    git("commit", "-m", "baseline");
    git("checkout", "-b", "feature");
    await writeFile(path.join(root, "file name.py"), "value = 2\n");
    git("add", ".");
    await writeFile(path.join(root, "file name.py"), "value = 3\n");
    const service = new GitService(root);
    assert.match(
      (await service.collect("staged", "", 50)).request.files[0]!.diff,
      /\+value = 2/,
    );
    assert.match(
      (await service.collect("working", "", 50)).request.files[0]!.diff,
      /\+value = 3/,
    );
    assert.equal(
      (await service.collect("file", "", 50, path.join(root, "file name.py")))
        .request.files.length,
      1,
    );
    git("add", ".");
    git("commit", "-m", "change");
    assert.equal(
      (await service.collect("working", "", 50)).request.files.length,
      0,
    );
    assert.match(
      (await service.collect("branch", "main", 50)).request.files[0]!.diff,
      /\+value = 3/,
    );
    await writeFile(path.join(root, "untracked.py"), "value = 4\n");
    assert.match(
      (await service.collect("working", "", 50)).warnings.join(),
      /Untracked/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
