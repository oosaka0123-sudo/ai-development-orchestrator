import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeBranchName, parseGitHubRepository } from "./repository.js";

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

test("accepts a generated branch name in the expected shape", () => {
  assert.doesNotThrow(() => assertSafeBranchName("ai/task-2026-09-02-a1b2c3d4"));
});

test("rejects main/master and anything not shaped like a generated branch name", () => {
  for (const branch of ["main", "master", "--force", "ai/task-2026-09-02", "feature/x", ""]) {
    assert.throws(() => assertSafeBranchName(branch), branch);
  }
});
