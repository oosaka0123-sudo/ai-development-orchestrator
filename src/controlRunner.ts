import path from "node:path";
import type { AppConfig } from "./config.js";
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
    defaultOwner,
  };

  const result = await executeTask(config, repository, buildControlTask(command), true);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const safe = safeErrorText(error, [
    process.env.ORCHESTRATOR_GITHUB_TOKEN,
    process.env.ANTHROPIC_API_KEY,
  ].filter((value): value is string => Boolean(value)));
  console.error(safe);
  process.exitCode = 1;
});
