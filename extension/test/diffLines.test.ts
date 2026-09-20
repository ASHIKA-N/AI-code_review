import { test } from "node:test";
import assert from "node:assert/strict";
import { addedLineMap } from "../src/diffLines";
import { reviewEditor } from "../src/editorAi";

test("maps only additions across context, deletions, and multiple hunks", () => {
  const diff = [
    "--- a/test.py",
    "+++ b/test.py",
    "@@ -2,2 +2,3 @@",
    " context",
    "-old",
    "+new",
    "+next",
    "@@ -20 +21 @@",
    "-old",
    "+changed",
  ].join("\n");
  assert.deepEqual(
    [...addedLineMap(diff)],
    [
      [6, 3],
      [7, 4],
      [10, 21],
    ],
  );
  assert.equal(addedLineMap(diff).has(2), false);
});
test("diff review sends selected rules and maps a provider finding to the source line", async () => {
  const diff = "--- a/test.py\n+++ b/test.py\n@@ -9 +9 @@\n-old\n+query()";
  const findings = await reviewEditor(
    { provider: "groq", model: "test-model", checks: ["errors"] },
    "test-key",
    diff,
    "unified Git diff",
    new AbortController().signal,
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(JSON.parse(body.messages[1].content).source, diff);
      assert.ok(body.messages[0].content.includes("Error handling"));
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                findings: [
                  {
                    check: "errors",
                    line: 5,
                    severity: "MEDIUM",
                    title: "Handle failure",
                    explanation: "Unhandled query failure",
                    suggestion: "Handle expected failures",
                  },
                ],
              }),
            },
          },
        ],
      });
    },
  );
  assert.equal(addedLineMap(diff).get(findings[0]!.line), 9);
});
