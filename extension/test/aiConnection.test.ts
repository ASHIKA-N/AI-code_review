import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectKey,
  detectProvider,
  selectModel,
  customConnection,
} from "../src/aiConnection";

test("key detection rejects ambiguous and unsupported formats", () => {
  assert.equal(detectProvider("sk-proj-example"), "openai");
  assert.equal(detectProvider("sk-ant-api03-example"), "claude");
  assert.equal(detectProvider("xai-example"), "grok");
  assert.equal(detectProvider("gsk_example"), "groq");
  assert.throws(() => detectProvider("sk-unknown"), /not recognized/);
  assert.throws(() => detectProvider("gsk-example"), /not recognized/);
});
test("automatic selection only uses supported models in the account list", () => {
  assert.equal(
    selectModel("openai", ["image-model", "gpt-4.1", "gpt-4.1-mini"]),
    "gpt-4.1-mini",
  );
  assert.throws(() => selectModel("openai", ["image-model"]), /No compatible/);
});
test("connection sends keys only to the detected provider and never includes code", async () => {
  for (const [key, host, model] of [
    ["sk-proj-example", "api.openai.com", "gpt-4.1-mini"],
    ["sk-ant-example", "api.anthropic.com", "claude-sonnet-4-6"],
    ["xai-example", "api.x.ai", "grok-3"],
    ["gsk_example", "api.groq.com", "llama-3.3-70b-versatile"],
  ]) {
    let calls = 0;
    const result = await connectKey(key!, async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).hostname, host);
      assert.equal(
        new URL(String(url)).pathname,
        host === "api.groq.com" ? "/openai/v1/models" : "/v1/models",
      );
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      return Response.json({ data: [{ id: model }] });
    });
    assert.equal(result.model, model);
    assert.equal(calls, 1);
  }
  await assert.rejects(
    connectKey("unknown-key", async () => {
      assert.fail("Unknown keys must not leave the extension");
    }),
    /not recognized/,
  );
});
test("custom endpoints reject insecure remote URLs and embedded credentials", () => {
  for (const url of [
    "http://example.com/v1",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?key=secret",
  ]) {
    assert.throws(() => customConnection(url, "test-model"));
  }
  assert.equal(
    customConnection("https://example.com/v1/", "test-model").baseUrl,
    "https://example.com/v1",
  );
});
test("connection hides provider errors", async () => {
  await assert.rejects(
    connectKey(
      "xai-example",
      async () => new Response("secret details", { status: 401 }),
    ),
    /Connection failed/,
  );
});
test("Groq connects when only GPT OSS models are returned", async () => {
  const result = await connectKey("gsk_test", async () => Response.json({ data: [{ id: "openai/gpt-oss-20b" }] }));
  assert.equal(result.model, "openai/gpt-oss-20b");
});
test("unknown catalog offers account models and validates the selection", async () => {
  const transport: typeof fetch = async () => Response.json({ data: [{ id: "new-chat-model" }] });
  const result = await connectKey("gsk_test", transport, async ids => { assert.deepEqual(ids, ["new-chat-model"]); return ids[0]; });
  assert.equal(result.model, "new-chat-model");
  await assert.rejects(connectKey("gsk_test", transport, async () => "invented"), /selection cancelled/);
});
