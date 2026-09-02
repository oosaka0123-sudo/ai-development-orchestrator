import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPostToolUseHook, filterGlobOutput, filterGrepOutput } from "./resultFilter.js";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "ado-results-"));
}

// -- filterGlobOutput --------------------------------------------------------

test("filterGlobOutput removes sensitive files mixed with ordinary ones, including nested paths", async () => {
  const workspace = await makeWorkspace();
  await mkdir(path.join(workspace, "src", "nested", "deep"), { recursive: true });
  await mkdir(path.join(workspace, "config"), { recursive: true });
  await writeFile(path.join(workspace, "src", "index.ts"), "export {};\n");
  await writeFile(path.join(workspace, "src", "nested", "deep", "file.ts"), "export {};\n");
  await writeFile(path.join(workspace, "config", ".env"), "SECRET=not-a-real-secret\n");
  await writeFile(path.join(workspace, "id_rsa"), "not a real key, test fixture\n");

  const output = {
    durationMs: 5,
    numFiles: 4,
    filenames: [
      path.join(workspace, "src", "index.ts"),
      path.join(workspace, "src", "nested", "deep", "file.ts"),
      path.join(workspace, "config", ".env"),
      path.join(workspace, "id_rsa"),
    ],
    truncated: false,
    totalMatches: 4,
    countIsComplete: true,
  };

  const result = (await filterGlobOutput(output, workspace)) as typeof output;
  assert.notEqual(result, null);
  assert.equal(result.numFiles, 2);
  assert.equal(result.totalMatches, 2);
  assert.deepEqual(
    result.filenames.sort(),
    [path.join(workspace, "src", "index.ts"), path.join(workspace, "src", "nested", "deep", "file.ts")].sort(),
  );
  // Nothing in the result should even name the excluded files.
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /\.env/);
  assert.doesNotMatch(serialized, /id_rsa/);
});

test("filterGlobOutput returns null (no change) when nothing sensitive matched", async () => {
  const workspace = await makeWorkspace();
  await writeFile(path.join(workspace, "index.ts"), "export {};\n");
  const output = { numFiles: 1, filenames: [path.join(workspace, "index.ts")], truncated: false };
  const result = await filterGlobOutput(output, workspace);
  assert.equal(result, null);
});

test("filterGlobOutput excludes a symlink that resolves to a sensitive file, even under an innocuous name", async () => {
  const workspace = await makeWorkspace();
  await writeFile(path.join(workspace, ".env"), "SECRET=not-a-real-secret\n");
  await symlink(path.join(workspace, ".env"), path.join(workspace, "config-notes.txt"));
  await writeFile(path.join(workspace, "index.ts"), "export {};\n");

  const output = {
    numFiles: 2,
    filenames: [path.join(workspace, "config-notes.txt"), path.join(workspace, "index.ts")],
    truncated: false,
  };
  const result = (await filterGlobOutput(output, workspace)) as typeof output;
  assert.notEqual(result, null);
  assert.deepEqual(result.filenames, [path.join(workspace, "index.ts")]);
});

test("filterGlobOutput excludes a symlink that escapes the workspace entirely", async () => {
  const workspace = await makeWorkspace();
  const outside = await makeWorkspace();
  await writeFile(path.join(outside, "real-file.txt"), "not actually secret, just a fixture\n");
  await symlink(path.join(outside, "real-file.txt"), path.join(workspace, "looks-fine.txt"));
  await writeFile(path.join(workspace, "index.ts"), "export {};\n");

  const output = {
    numFiles: 2,
    filenames: [path.join(workspace, "looks-fine.txt"), path.join(workspace, "index.ts")],
    truncated: false,
  };
  const result = (await filterGlobOutput(output, workspace)) as typeof output;
  assert.notEqual(result, null);
  assert.deepEqual(result.filenames, [path.join(workspace, "index.ts")]);
});

// -- filterGrepOutput ---------------------------------------------------------

test("filterGrepOutput (files_with_matches mode) removes sensitive files without touching allowed ones", async () => {
  const workspace = await makeWorkspace();
  await mkdir(path.join(workspace, ".git"), { recursive: true });
  await writeFile(path.join(workspace, ".git", "config"), "[core]\n");
  await writeFile(path.join(workspace, "README.md"), "hello\n");

  const output = {
    mode: "files_with_matches" as const,
    numFiles: 2,
    filenames: [path.join(workspace, ".git", "config"), path.join(workspace, "README.md")],
    totalFiles: 2,
  };
  const result = (await filterGrepOutput(output, workspace)) as typeof output;
  assert.notEqual(result, null);
  assert.deepEqual(result.filenames, [path.join(workspace, "README.md")]);
  assert.equal(result.numFiles, 1);
  assert.equal(result.totalFiles, 1);
});

test("filterGrepOutput (content mode) withholds content entirely rather than guess at partial redaction", async () => {
  const workspace = await makeWorkspace();
  await writeFile(path.join(workspace, "secrets.json"), '{"key":"not-a-real-secret"}\n');
  await writeFile(path.join(workspace, "app.ts"), "const key = 1;\n");

  const output = {
    mode: "content" as const,
    numFiles: 2,
    filenames: [path.join(workspace, "secrets.json"), path.join(workspace, "app.ts")],
    content: `${path.join(workspace, "secrets.json")}:1:not-a-real-secret\n${path.join(workspace, "app.ts")}:1:const key = 1;\n`,
    numLines: 2,
    numMatches: 2,
    totalLines: 2,
  };
  const result = (await filterGrepOutput(output, workspace)) as typeof output;
  assert.notEqual(result, null);
  assert.equal(result.content, "");
  assert.equal(result.numLines, 0);
  assert.equal(result.numMatches, 0);
  assert.equal(result.totalLines, 0);
  assert.deepEqual(result.filenames, [path.join(workspace, "app.ts")]);
  // The withheld secret value must not survive anywhere in the result.
  assert.doesNotMatch(JSON.stringify(result), /not-a-real-secret/);
});

test("filterGrepOutput returns null (no change) when nothing sensitive matched", async () => {
  const workspace = await makeWorkspace();
  await writeFile(path.join(workspace, "app.ts"), "const x = 1;\n");
  const output = {
    mode: "files_with_matches" as const,
    numFiles: 1,
    filenames: [path.join(workspace, "app.ts")],
  };
  const result = await filterGrepOutput(output, workspace);
  assert.equal(result, null);
});

// -- createPostToolUseHook (end-to-end wiring) --------------------------------

function hookInput(toolName: string, toolResponse: unknown) {
  return {
    hook_event_name: "PostToolUse" as const,
    session_id: "s1",
    transcript_path: "/tmp/transcript",
    cwd: "/tmp",
    tool_name: toolName,
    tool_input: {},
    tool_response: toolResponse,
    tool_use_id: "t1",
  };
}

test("createPostToolUseHook rewrites Glob output when it contains a sensitive file", async () => {
  const workspace = await makeWorkspace();
  await writeFile(path.join(workspace, ".env"), "SECRET=not-a-real-secret\n");
  await writeFile(path.join(workspace, "index.ts"), "export {};\n");
  const hook = createPostToolUseHook(workspace);

  const result = await hook(
    hookInput("Glob", { numFiles: 2, filenames: [path.join(workspace, ".env"), path.join(workspace, "index.ts")] }),
    "t1",
    { signal: new AbortController().signal },
  );
  assert.ok("hookSpecificOutput" in result);
  const output = (result as { hookSpecificOutput: { updatedToolOutput: { filenames: string[] } } }).hookSpecificOutput
    .updatedToolOutput;
  assert.deepEqual(output.filenames, [path.join(workspace, "index.ts")]);
});

test("createPostToolUseHook is a no-op for Glob/Grep results with nothing sensitive", async () => {
  const workspace = await makeWorkspace();
  await writeFile(path.join(workspace, "index.ts"), "export {};\n");
  const hook = createPostToolUseHook(workspace);
  const result = await hook(
    hookInput("Glob", { numFiles: 1, filenames: [path.join(workspace, "index.ts")] }),
    "t1",
    { signal: new AbortController().signal },
  );
  assert.deepEqual(result, {});
});

test("createPostToolUseHook never touches non-Grep/Glob tools", async () => {
  const workspace = await makeWorkspace();
  const hook = createPostToolUseHook(workspace);
  const result = await hook(hookInput("Read", { content: "whatever" }), "t1", {
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, {});
});
