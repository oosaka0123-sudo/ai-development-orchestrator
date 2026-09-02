import path from "node:path";

export interface AppConfig {
  port: number;
  workspaceRoot: string;
  authToken: string;
  githubToken?: string;
  anthropicApiKey?: string;
  defaultOwner: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const authToken = env.MCP_AUTH_TOKEN;
  if (!authToken) {
    // Fail closed, always: an unset token must never mean "open". The /mcp
    // endpoint can push commits and open PRs (via execute_repository_task)
    // using GITHUB_TOKEN/ANTHROPIC_API_KEY on behalf of anyone who reaches
    // it -- there is no safe default here.
    throw new Error(
      "MCP_AUTH_TOKEN is not set. This is required, not optional -- without it " +
        "the /mcp endpoint would accept requests (including execute_repository_task, " +
        "which pushes commits and opens PRs) from anyone who can reach it.",
    );
  }
  return {
    port: Number(env.PORT ?? 3000),
    workspaceRoot: path.resolve(env.WORKSPACE_ROOT ?? ".workspaces"),
    authToken,
    githubToken: env.GITHUB_TOKEN,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    defaultOwner: env.DEFAULT_OWNER ?? "oosaka0123-sudo",
  };
}

export function requireSecrets(config: AppConfig): asserts config is AppConfig & {
  githubToken: string;
  anthropicApiKey: string;
} {
  const missing = [
    !config.githubToken && "GITHUB_TOKEN",
    !config.anthropicApiKey && "ANTHROPIC_API_KEY",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}
