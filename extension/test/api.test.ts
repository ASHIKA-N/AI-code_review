import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { ApiClient, validateBackendUrl } from "../src/api";

test("remote backends require TLS and no embedded credentials", () => {
  assert.throws(() => validateBackendUrl("http://example.com"));
  assert.throws(() => validateBackendUrl("https://user:password@example.com"));
  assert.equal(
    validateBackendUrl("http://127.0.0.1:8000/"),
    "http://127.0.0.1:8000",
  );
});

test("API client sends authentication and validates real HTTP responses", async () => {
  let valid = true;
  const server = createServer((request, response) => {
    assert.equal(request.headers["x-verireview-key"], "test-key");
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        valid
          ? {
              status: "ok",
              version: "0.1.0",
              ai_provider: "mock",
              ai_configured: true,
              semgrep_available: false,
            }
          : { status: "ok" },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = new ApiClient(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      "test-key",
    );
    assert.equal((await client.health()).ai_provider, "mock");
    valid = false;
    await assert.rejects(client.health(), /invalid response contract/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
