import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, requireCouncilSecrets } from "./config.js";

test("throws when MCP_AUTH_TOKEN is missing (fail closed, never optional)", () => {
  assert.throws(() => loadConfig({}), /MCP_AUTH_TOKEN/);
});

test("throws when MCP_AUTH_TOKEN is empty", () => {
  assert.throws(() => loadConfig({ MCP_AUTH_TOKEN: "" }), /MCP_AUTH_TOKEN/);
});

test("loads successfully once MCP_AUTH_TOKEN is set", () => {
  const config = loadConfig({ MCP_AUTH_TOKEN: "secret" });
  assert.equal(config.authToken, "secret");
  assert.equal(config.defaultOwner, "oosaka0123-sudo");
  assert.equal(config.anthropicCouncilModel, "claude-sonnet-5");
  assert.equal(config.geminiCouncilModel, "gemini-3.8-flash");
  assert.equal(config.openaiCouncilModel, "gpt-5.6-terra");
});

test("AI Council fails closed unless all provider credentials are configured", () => {
  const config = loadConfig({
    MCP_AUTH_TOKEN: "auth",
    GITHUB_TOKEN: "github",
    ANTHROPIC_API_KEY: "anthropic",
  });
  assert.throws(() => requireCouncilSecrets(config), /GEMINI_API_KEY/);

  const ready = loadConfig({
    MCP_AUTH_TOKEN: "auth",
    GITHUB_TOKEN: "github",
    ANTHROPIC_API_KEY: "anthropic",
    GEMINI_API_KEY: "gemini",
    OPENAI_API_KEY: "openai",
  });
  assert.doesNotThrow(() => requireCouncilSecrets(ready));
});
