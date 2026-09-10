import path from "node:path";
import type { AppConfig } from "./config.js";
import { requireCouncilSecrets } from "./config.js";
import { councilImplementationContext, runResumeCouncil } from "./council.js";
import { buildControlTask, normalizeControlRepository, parseControlCommand } from "./controlTask.js";
import { safeErrorText } from "./logging.js";
import { executeTask } from "./orchestrator.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const defaultOwner = process.env.DEFAULT_OWNER ?? "oosaka0123-sudo";
  const repository = normalizeControlRepository(required("CONTROL_REPOSITORY"), defaultOwner);
  const command = parseControlCommand(required("CONTROL_COMMAND"));
  const githubToken = required("ORCHESTRATOR_GITHUB_TOKEN");
  const anthropicApiKey = required("ANTHROPIC_API_KEY");

  const config: AppConfig = {
    port: 0,
    workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT ?? ".workspaces"),
    authToken: "control-runner-no-http-auth",
    githubToken,
    anthropicApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicCouncilModel: process.env.ANTHROPIC_COUNCIL_MODEL ?? "claude-sonnet-5",
    geminiCouncilModel: process.env.GEMINI_COUNCIL_MODEL ?? "gemini-3.8-flash",
    openaiCouncilModel: process.env.OPENAI_COUNCIL_MODEL ?? "gpt-5.6-terra",
    defaultOwner,
  };

  let task = buildControlTask(command);
  let council: Awaited<ReturnType<typeof runResumeCouncil>> | undefined;

  if (command === "resume") {
    requireCouncilSecrets(config);
    council = await runResumeCouncil(config, repository);
    if (!council.allowResume) {
      process.stdout.write(`${JSON.stringify({
        repository,
        command,
        council: {
          status: council.status,
          allowResume: false,
          blockers: council.blockers,
        },
        execution: "blocked-before-implementation",
      }, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    task = `${task}\n\n${councilImplementationContext(council)}`;
  }

  const result = await executeTask(config, repository, task, true);
  process.stdout.write(`${JSON.stringify({
    council: council ? { status: council.status, allowResume: council.allowResume } : undefined,
    result,
  }, null, 2)}\n`);
}

main().catch((error) => {
  const safe = safeErrorText(error, [
    process.env.ORCHESTRATOR_GITHUB_TOKEN,
    process.env.ANTHROPIC_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
  ].filter((value): value is string => Boolean(value)));
  console.error(safe);
  process.exitCode = 1;
});
