import assert from "node:assert/strict";
import test from "node:test";
import { redact, safeErrorText } from "./logging.js";

test("redact replaces every occurrence of a secret", () => {
  const text = "token=abc123secret and again abc123secret";
  assert.equal(redact(text, ["abc123secret"]), "token=[REDACTED] and again [REDACTED]");
});

test("redact ignores undefined/short values instead of over-matching", () => {
  const text = "short value ab stays";
  assert.equal(redact(text, [undefined, "ab"]), "short value ab stays");
});

test("safeErrorText redacts a token embedded in an Error message", () => {
  const error = new Error("GitHub API 401 Authorization: Bearer ghs_supersecrettoken");
  const text = safeErrorText(error, ["ghs_supersecrettoken"]);
  assert.doesNotMatch(text, /ghs_supersecrettoken/);
  assert.match(text, /\[REDACTED\]/);
});

test("safeErrorText redacts multiple distinct secrets from the same error", () => {
  const error = new Error("failed with github=ghp_abc anthropic=sk-ant-xyz");
  const text = safeErrorText(error, ["ghp_abc", "sk-ant-xyz"]);
  assert.doesNotMatch(text, /ghp_abc/);
  assert.doesNotMatch(text, /sk-ant-xyz/);
});
