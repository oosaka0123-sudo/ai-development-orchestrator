import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubRepository } from "./repository.js";

test("parses HTTPS clone URL", () => {
  assert.deepEqual(
    parseGitHubRepository("https://github.com/oosaka0123-sudo/ai-development-orchestrator.git", "fallback"),
    {
      owner: "oosaka0123-sudo",
      repo: "ai-development-orchestrator",
      cloneUrl: "https://github.com/oosaka0123-sudo/ai-development-orchestrator.git",
    },
  );
});

test("uses default owner for a bare repository name", () => {
  assert.equal(parseGitHubRepository("demo-site", "oosaka0123-sudo").owner, "oosaka0123-sudo");
});

test("rejects malformed repository values", () => {
  assert.throws(() => parseGitHubRepository("https://github.com/a/b/extra", "fallback"));
});
