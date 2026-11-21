import path from "node:path";
import type { AppConfig } from "./config.js";
import { requireCouncilSecrets } from "./config.js";
import { runResumeCouncil } from "./council.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function bullets(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

async function main() {
  const defaultOwner = process.env.DEFAULT_OWNER ?? "oosaka0123-sudo";
  const repository = required("REVIEW_REPOSITORY");
  const config: AppConfig = {
    port: 0,
    workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT ?? ".workspaces"),
    authToken: "review-runner-no-http-auth",
    githubToken: required("ORCHESTRATOR_GITHUB_TOKEN"),
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    geminiApiKey: required("GEMINI_API_KEY"),
    openaiApiKey: required("OPENAI_API_KEY"),
    anthropicCouncilModel: process.env.ANTHROPIC_COUNCIL_MODEL ?? "claude-sonnet-5",
    geminiCouncilModel: process.env.GEMINI_COUNCIL_MODEL ?? "gemini-3.8-flash",
    openaiCouncilModel: process.env.OPENAI_COUNCIL_MODEL ?? "gpt-5.6-terra",
    defaultOwner,
  };
  requireCouncilSecrets(config);
  const result = await runResumeCouncil(config, repository);
  const finalRound = result.rounds[2];
  const sections = ([
    ["Claude", finalRound.claude],
    ["Gemini", finalRound.gemini],
    ["ChatGPT", finalRound.chatgpt],
  ] as const).map(([name, vote]) => [
    `### ${name} — ${vote.status}`,
    vote.summary,
    "",
    "**Risks**",
    bullets(vote.risks),
    "",
    "**Blockers**",
    bullets(vote.blockers),
    "",
    "**Next**",
    bullets(vote.next),
    "",
    "**Evidence**",
    bullets(vote.evidence),
  ].join("\n"));

  process.stdout.write([
    "## 3-AI Council review complete",
    "",
    `Repository: \`${repository}\``,
    `Overall: **${result.status}**`,
    `Implementation allowed by resume policy: **${result.allowResume}**`,
    "",
    "This run is review-only. No implementation task was invoked.",
    "",
    ...sections,
    "",
    "### Consolidated",
    result.summary,
    "",
    "**Consolidated blockers**",
    bullets(result.blockers),
    "",
    "**Consolidated next actions**",
    bullets(result.next),
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
