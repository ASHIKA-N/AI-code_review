import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFindings, reviewEditor, Settings, checklistPreferencesSchema } from "../src/editorAi";

const settings: Settings = {
  provider: "openai",
  model: "test-model",
  checks: ["unused"],
};
const finding = {
  check: "unused",
  line: 1,
  severity: "LOW",
  title: "Unused variable",
  explanation: "Never read",
  suggestion: "Remove if safe",
};
test("custom-only review includes enabled rules and accepts their findings", async () => {
  const custom: Settings = { ...settings, checks: ["custom_one"], customChecks: [
    { id: "custom_one", description: "Require parameterized SQL queries" },
    { id: "custom_two", description: "Require tracing" },
  ] };
  const result = await reviewEditor(custom, "test-key", "query()", "python", new AbortController().signal, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.messages[0].content.includes("Require parameterized SQL queries"));
    assert.ok(!body.messages[0].content.includes("Require tracing"));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ findings: [{ ...finding, check: "custom_one" }] }) } }] });
  });
  assert.equal(result[0]?.check, "custom_one");
  assert.throws(() => parseFindings(JSON.stringify({ findings: [{ ...finding, check: "custom_two" }] }), custom, 1));
});
test("custom preferences validate definitions and survive serialization", () => {
  const prefs = { checks: [], customChecks: [{ id: "custom_one", description: "Check SQL" }] };
  assert.deepEqual(checklistPreferencesSchema.parse(JSON.parse(JSON.stringify(prefs))), prefs);
  assert.throws(() => checklistPreferencesSchema.parse({ checks: ["custom_missing"] }));
  assert.throws(() => checklistPreferencesSchema.parse({ ...prefs, customChecks: [prefs.customChecks[0], prefs.customChecks[0]] }));
  assert.throws(() => checklistPreferencesSchema.parse({ checks: [], customChecks: [{ id: "custom_one", description: " " }] }));
});

test("rejects unselected checks, invented lines and malformed findings", () => {
  for (const change of [
    { check: "loops" },
    { line: 3 },
    { line: 0 },
    { severity: "CONFIRMED" },
  ]) {
    assert.throws(() =>
      parseFindings(
        JSON.stringify({ findings: [{ ...finding, ...change }] }),
        settings,
        2,
      ),
    );
  }
  assert.deepEqual(parseFindings('{"findings":[]}', settings, 2), []);
});

test("provider requests use selected checks, correct authentication and validated findings", async () => {
  for (const provider of [
    "openai",
    "claude",
    "grok",
    "groq",
    "custom",
  ] as const) {
    const transport: typeof fetch = async (url, init) => {
      assert.equal(
        new URL(String(url)).hostname,
        {
          openai: "api.openai.com",
          claude: "api.anthropic.com",
          grok: "api.x.ai",
          groq: "api.groq.com",
          custom: "example.com",
        }[provider],
      );
      if (provider === "groq")
        assert.equal(
          new URL(String(url)).pathname,
          "/openai/v1/chat/completions",
        );
      if (provider === "custom")
        assert.equal(new URL(String(url)).pathname, "/v1/chat/completions");
      const headers = new Headers(init?.headers);
      assert.equal(
        provider === "claude"
          ? headers.get("x-api-key")
          : headers.get("Authorization"),
        provider === "claude" ? "test-key" : "Bearer test-key",
      );
      const body = JSON.parse(String(init?.body));
      const instruction: string =
        provider === "claude" ? body.system : body.messages[0].content;
      assert.ok(instruction.includes("Unused variables and imports"));
      assert.ok(!instruction.includes("Missing test coverage"));
      assert.equal(init?.redirect, "error");
      const content = JSON.stringify({ findings: [finding] });
      return Response.json(
        provider === "claude"
          ? {
              stop_reason: "end_turn",
              content: [{ type: "text", text: content }],
            }
          : { choices: [{ finish_reason: "stop", message: { content } }] },
      );
    };
    assert.deepEqual(
      await reviewEditor(
        {
          ...settings,
          provider,
          baseUrl: provider === "custom" ? "https://example.com/v1" : undefined,
        },
        "test-key",
        "x = 1",
        "python",
        new AbortController().signal,
        transport,
      ),
      [finding],
    );
  }
});

test("rejects large input before upload and hides provider error bodies", async () => {
  const transport: typeof fetch = async () => {
    throw new Error("must not send");
  };
  await assert.rejects(
    reviewEditor(
      settings,
      "key",
      "x".repeat(100_001),
      "python",
      new AbortController().signal,
      transport,
    ),
    /100 KB/,
  );
  await assert.rejects(
    reviewEditor(
      settings,
      "key",
      "x=1",
      "python",
      new AbortController().signal,
      async () => new Response("private provider error", { status: 401 }),
    ),
    /rejected the API key/,
  );
});

test("rejects truncated model responses", async () => {
  await assert.rejects(
    reviewEditor(
      settings,
      "key",
      "x=1",
      "python",
      new AbortController().signal,
      async () =>
        Response.json({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"findings":[]}' },
            },
          ],
        }),
    ),
    /incomplete or invalid/,
  );
});
