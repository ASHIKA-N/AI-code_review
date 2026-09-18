import { z } from "zod";
import { healthSchema, reviewSchema, ReviewRequest } from "./models";

export function validateBackendUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Backend URL must not contain credentials, a query or a fragment.",
    );
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      "Use HTTPS for remote backends; HTTP is allowed only on loopback.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export class ApiClient {
  private readonly base: string;
  constructor(
    base: string,
    private readonly key = "",
  ) {
    this.base = validateBackendUrl(base);
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: ReviewRequest,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-VeriReview-Key": this.key,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "Backend authentication failed. Run Configure Backend.",
        413: "The review is too large. Try staged changes or a single file.",
        422: "The backend rejected the review input. Check paths and diff size.",
        429: "Review rate limit reached. Try again later.",
      };
      throw new Error(
        messages[response.status] ??
          `Backend returned HTTP ${response.status}.`,
      );
    }
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new Error("Backend response exceeds the size limit.");
    const parsed = schema.safeParse(JSON.parse(text) as unknown);
    if (!parsed.success)
      throw new Error("Backend returned an invalid response contract.");
    return parsed.data;
  }
  health() {
    return this.request("/api/v1/health", healthSchema);
  }
  review(body: ReviewRequest, signal: AbortSignal) {
    return this.request("/api/v1/reviews", reviewSchema, body, signal);
  }
}
