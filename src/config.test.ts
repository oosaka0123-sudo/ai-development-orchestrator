import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

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
});
