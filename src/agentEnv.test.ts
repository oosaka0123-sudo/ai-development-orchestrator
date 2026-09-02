import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentEnv } from "./agentEnv.js";

test("never carries GITHUB_TOKEN or MCP_AUTH_TOKEN into the agent's environment", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/user",
    GITHUB_TOKEN: "ghp_secret",
    MCP_AUTH_TOKEN: "mcp_secret",
    ANTHROPIC_API_KEY: "should-be-ignored-source-value",
    SOME_OTHER_SECRET: "leak-me-not",
  };
  const env = buildAgentEnv("real-api-key", source);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.MCP_AUTH_TOKEN, undefined);
  assert.equal(env.SOME_OTHER_SECRET, undefined);
});

test("carries only the anthropic key and a small allow-list of inherited vars", () => {
  const source = { PATH: "/usr/bin", HOME: "/home/user", RANDOM_VAR: "x" };
  const env = buildAgentEnv("real-api-key", source);
  assert.equal(env.ANTHROPIC_API_KEY, "real-api-key");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/user");
  assert.equal(env.RANDOM_VAR, undefined);
});

test("the passed-in API key always wins even if present in the source", () => {
  const source = { ANTHROPIC_API_KEY: "wrong-key" };
  const env = buildAgentEnv("correct-key", source);
  assert.equal(env.ANTHROPIC_API_KEY, "correct-key");
});
