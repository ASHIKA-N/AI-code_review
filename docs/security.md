# Initial security boundaries

- Only explicit commands run reviews, and untrusted VS Code workspaces are unsupported.
- Git runs with an argument array, no shell, disabled external diff/text conversion,
  literal pathspecs, a 15-second timeout and a bounded stdout buffer.
- Paths entering the backend must be relative POSIX paths without traversal. They are
  metadata, never server-side file requests. Editor navigation checks real paths against
  the repository root, including symlinks.
- Remote endpoints require TLS; the HTTP client refuses redirects. API keys use
  SecretStorage. Production configuration refuses an empty key.
- The API caps streamed body bytes and total diff bytes. Validation errors omit source
  input. There is no wildcard CORS configuration or raw-source persistence.
- AI review, static confirmation and test execution are not claimed in mock mode.
- No code patches or repository tests are executed.

Before remote production use, implement rate limiting, time-bounded streamed response
reading, pre-upload secret redaction, Bedrock request budgets, production observability
and authenticated deployment. The current development service is intended for loopback.
