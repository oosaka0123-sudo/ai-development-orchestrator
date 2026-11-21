import path from "node:path";
import type { AppConfig } from "./config.js";
import { planTask } from "./orchestrator.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const repository = required("REVIEW_REPOSITORY");
  const config: AppConfig = {
    port: 0,
    workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT ?? ".workspaces"),
    authToken: "claude-review-only",
    githubToken: required("GITHUB_TOKEN"),
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    geminiApiKey: undefined,
    openaiApiKey: undefined,
    anthropicCouncilModel: "unused",
    geminiCouncilModel: "unused",
    openaiCouncilModel: "unused",
    defaultOwner: process.env.DEFAULT_OWNER ?? "oosaka0123-sudo",
  };
  const task = [
    "ANALYSIS-ONLY independent production-readiness review.",
    "Do not modify files, do not commit, do not push, and do not create a pull request.",
    "Review the CURRENT default branch of this repository as a completed public site.",
    "Focus on implementation correctness, regressions, data integrity and stale-price risk,",
    "affiliate integration/disclosure, SEO/sitemap/indexing/IndexNow, CI/security permissions,",
    "accessibility/mobile UX, maintainability, and operational risk.",
    "Return actionable findings grouped High / Medium / Low with exact file paths/evidence.",
    "Explicitly state if there are no High findings. Avoid cosmetic churn.",
  ].join("\n");
  const result = await planTask(config, repository, task);
  process.stdout.write([
    "## Claude independent repository review",
    "",
    `Repository: \`${repository}\``,
    "",
    result.plan,
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
