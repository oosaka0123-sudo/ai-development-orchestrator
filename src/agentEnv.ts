/**
 * The Claude Agent SDK's `env` option REPLACES the subprocess environment
 * entirely rather than merging with it (confirmed against the installed
 * SDK's own type declarations, not assumed) -- so spreading `process.env`
 * here, as the original implementation did, hands the agent (and every Bash
 * command it runs) GITHUB_TOKEN and MCP_AUTH_TOKEN, neither of which the
 * agent process itself needs. Only ANTHROPIC_API_KEY does. This builds an
 * explicit allow-list instead: the agent gets what it needs to run, never
 * the orchestrator's own secrets.
 */
const INHERITED_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SHELL",
] as const;

export function buildAgentEnv(
  anthropicApiKey: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: anthropicApiKey };
  for (const key of INHERITED_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
