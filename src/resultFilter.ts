import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { checkWorkspacePath } from "./permissions.js";

/**
 * canUseTool only gates a Grep/Glob CALL (its `path`/`glob`/`pattern`
 * arguments) -- it cannot know in advance which individual files a
 * directory-wide search will actually touch, so a sensitive file sitting
 * next to ordinary ones in an otherwise-permitted directory could still
 * surface in the RESULT. This module is the second, independent
 * enforcement point: a PostToolUse hook (see agent.ts) that inspects what
 * Grep/Glob actually found and removes anything sensitive before it ever
 * reaches the model, using the exact same rules as
 * permissions.ts::checkWorkspacePath (workspace containment, sensitive-file
 * classification, realpath/symlink resolution) -- not a second, divergent
 * set of rules, and not left to the model to police itself.
 *
 * Nothing here discloses that a match was withheld: no count, no filename,
 * no reason. A caller sees exactly the same shape as "no sensitive file
 * matched" -- existence of a matching sensitive file is not observable
 * from the response.
 */

interface FileListOutput {
  filenames?: unknown;
  numFiles?: unknown;
  totalMatches?: unknown;
  countIsComplete?: unknown;
  [key: string]: unknown;
}

interface GrepLikeOutput extends FileListOutput {
  content?: unknown;
  numLines?: unknown;
  numMatches?: unknown;
  totalFiles?: unknown;
  totalLines?: unknown;
}

async function partitionFilenames(
  filenames: string[],
  workspaceRoot: string,
): Promise<{ allowed: string[]; deniedCount: number }> {
  const allowed: string[] = [];
  let deniedCount = 0;
  for (const name of filenames) {
    // eslint-disable-next-line no-await-in-loop -- sequential is fine; result sets are capped (Glob truncates at 100)
    const verdict = await checkWorkspacePath(name, workspaceRoot);
    if (verdict.allowed) {
      allowed.push(name);
    } else {
      deniedCount += 1;
    }
  }
  return { allowed, deniedCount };
}

function hasFilenamesArray(output: unknown): output is FileListOutput {
  if (typeof output !== "object" || output === null) return false;
  const filenames = (output as FileListOutput).filenames;
  return Array.isArray(filenames) && filenames.every((f: unknown) => typeof f === "string");
}

/** Returns a filtered copy of Glob's output, or `null` when nothing needed to change. */
export async function filterGlobOutput(output: unknown, workspaceRoot: string): Promise<unknown | null> {
  if (!hasFilenamesArray(output)) return null;
  const filenames = output.filenames as string[];
  const { allowed, deniedCount } = await partitionFilenames(filenames, workspaceRoot);
  if (deniedCount === 0) return null;

  const result: FileListOutput = { ...output, filenames: allowed, numFiles: allowed.length };
  if ("totalMatches" in output) result.totalMatches = allowed.length;
  if ("countIsComplete" in output) result.countIsComplete = true;
  return result;
}

/** Returns a filtered copy of Grep's output, or `null` when nothing needed to change. */
export async function filterGrepOutput(output: unknown, workspaceRoot: string): Promise<unknown | null> {
  if (!hasFilenamesArray(output)) return null;
  const grep = output as GrepLikeOutput;
  const filenames = grep.filenames as string[];
  const { allowed, deniedCount } = await partitionFilenames(filenames, workspaceRoot);
  if (deniedCount === 0) return null;

  const result: GrepLikeOutput = { ...grep, filenames: allowed, numFiles: allowed.length };
  if ("totalFiles" in grep) result.totalFiles = allowed.length;

  // `content` is raw, tool-specific text (ripgrep-style "path:line:match"
  // lines) that this module does not parse. Surgically removing only the
  // denied files' lines from it would depend on an output format this
  // codebase doesn't control and isn't guaranteed to match exactly -- so
  // rather than guess at a partial redaction that could leave a sensitive
  // line in place, any content-mode result touching a denied file is
  // withheld in full. files_with_matches/count modes have no `content` to
  // begin with, so filtering `filenames` alone already fully protects them
  // without losing any legitimate match info for the allowed files.
  if (typeof grep.content === "string") {
    result.content = "";
    if ("numLines" in grep) result.numLines = 0;
    if ("numMatches" in grep) result.numMatches = 0;
    if ("totalLines" in grep) result.totalLines = 0;
  }
  return result;
}

/**
 * PostToolUse hook: the second, code-enforced pass over Grep/Glob output
 * (see the module doc comment above). Any other tool's PostToolUse event is
 * a no-op -- this never touches Read/Edit/Write/Bash output.
 */
export function createPostToolUseHook(workspaceRoot: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    if (input.tool_name === "Glob") {
      const updated = await filterGlobOutput(input.tool_response, workspaceRoot);
      if (updated !== null) {
        return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } };
      }
    }
    if (input.tool_name === "Grep") {
      const updated = await filterGrepOutput(input.tool_response, workspaceRoot);
      if (updated !== null) {
        return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } };
      }
    }
    return {};
  };
}
