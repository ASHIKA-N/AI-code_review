import { z } from "zod";

export const severitySchema = z.enum([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "SUGGESTION",
]);
export const findingSchema = z.object({
  id: z.string(),
  file_path: z.string(),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  severity: severitySchema,
  category: z.enum([
    "CORRECTNESS",
    "SECURITY",
    "PERFORMANCE",
    "ERROR_HANDLING",
    "TESTING",
    "MAINTAINABILITY",
    "OBSERVABILITY",
    "ARCHITECTURE",
    "TEAM_STANDARD",
    "RELIABILITY",
  ]),
  title: z.string(),
  description: z.string(),
  why_it_matters: z.string(),
  suggestion: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({ type: z.string(), description: z.string(), source: z.string() }),
  ),
  source: z.string(),
  rule_id: z.string(),
  suggested_patch: z.string().nullable(),
  verification_status: z.string(),
  fingerprint: z.string(),
  created_at: z.string(),
});
export const reviewSchema = z.object({
  review_id: z.string(),
  repository: z.string(),
  branch: z.string(),
  provider: z.string(),
  files_reviewed: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
  summary: z.record(z.number()),
  findings: z.array(findingSchema),
  coverage: z.object({
    submitted_files: z.number(),
    analyzed_files: z.number(),
    skipped_files: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
});
export const healthSchema = z.object({
  status: z.string(),
  version: z.string(),
  ai_provider: z.string(),
  ai_configured: z.boolean(),
  semgrep_available: z.boolean(),
});
export type Finding = z.infer<typeof findingSchema>;
export type Review = z.infer<typeof reviewSchema>;
export interface ReviewRequest {
  repository: string;
  branch: string;
  files: { path: string; diff: string }[];
  minimum_confidence: number;
  max_findings: number;
}
