import { z } from "zod";
import { Settings } from "./editorAi";
import { validateBackendUrl } from "./api";

export type Connection = Pick<Settings, "provider" | "model" | "baseUrl">;
export function customConnection(baseUrl: string, model: string): Connection {
  const cleanModel = z
    .string()
    .trim()
    .min(1)
    .max(150)
    .regex(/^[a-zA-Z0-9._:/-]+$/)
    .parse(model);
  return {
    provider: "custom",
    model: cleanModel,
    baseUrl: validateBackendUrl(baseUrl.trim()),
  };
}
export function detectProvider(key: string): Connection["provider"] {
  if (/^sk-ant-[\w-]+$/.test(key)) return "claude";
  if (/^xai-[\w-]+$/.test(key)) return "grok";
  if (/^gsk_[\w-]+$/.test(key)) return "groq";
  if (/^sk-(?:proj|svcacct)-[\w-]+$/.test(key)) return "openai";
  throw new Error(
    "Key format not recognized. Open Custom connection for an OpenAI-compatible service, or use an OpenAI project, Claude, Grok or Groq key.",
  );
}

export function selectModel(
  provider: Connection["provider"],
  ids: string[],
): string {
  const preferred = {
    custom: [],
    groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
    claude: [
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
    ],
    grok: [
      "grok-4.1-fast-non-reasoning",
      "grok-4-fast-non-reasoning",
      "grok-4.3",
      "grok-4.6",
      "grok-3-mini",
      "grok-3",
    ],
  }[provider];
  const model = preferred.find((id) => ids.includes(id));
  if (!model)
    throw new Error(
      "No compatible review model was found for this account. Automatic model support needs updating or your account needs model access.",
    );
  return model;
}

export async function connectKey(
  key: string,
  transport: typeof fetch = fetch,
  chooseModel?: (ids: string[]) => Promise<string | undefined>,
): Promise<Connection> {
  key = key.trim();
  const provider = detectProvider(key);
  const base = {
    openai: "https://api.openai.com",
    claude: "https://api.anthropic.com",
    grok: "https://api.x.ai",
    groq: "https://api.groq.com/openai",
    custom: "",
  }[provider];
  try {
    const response = await transport(`${base}/v1/models`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers:
        provider === "claude"
          ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 401
          ? `Connection failed (${provider}, HTTP 401): API key rejected. Use a valid, unrevoked key from this provider.`
          : response.status === 403
            ? `Connection failed (${provider}, HTTP 403): access denied. Check account and model-list permissions.`
            : response.status === 429
              ? `Connection failed (${provider}, HTTP 429): rate limit or quota reached. Try again later.`
              : `Connection failed (${provider}, HTTP ${response.status}): provider could not complete the request.`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty model list.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1_000_000) {
          await reader.cancel();
          throw new Error("Model list is too large.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const models = z
      .object({ data: z.array(z.object({ id: z.string() })) })
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const ids = [...new Set(models.data.map(m => m.id))].filter(id => /^[a-zA-Z0-9._:/-]{1,150}$/.test(id));
    let model: string;
    try { model = selectModel(provider, ids); }
    catch (error) {
      if (!chooseModel || !ids.length) throw error;
      const chosen = await chooseModel(ids);
      if (!chosen || !ids.includes(chosen)) throw new Error("Model selection cancelled. Your previous connection was kept.");
      model = chosen;
    }
    return { provider, model };
  } catch (error) {
    if (
      error instanceof Error &&
      /^(Connection failed|No compatible|Model selection cancelled)/.test(error.message)
    )
      throw error;
    throw new Error(
      `Could not connect to ${provider}. Check your network, proxy or firewall and try again. The request may have timed out or returned an invalid model list.`,
    );
  }
}
