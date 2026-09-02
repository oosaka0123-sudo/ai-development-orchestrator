import { promises as fsp } from "node:fs";
import path from "node:path";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { classifySensitivity } from "./sensitiveFiles.js";

/**
 * Blocks chaining, redirection, and substitution so a whitelist match on the
 * first token (e.g. "npm test") cannot smuggle a second, unvetted command
 * alongside it via "&&" / ";" / "|" / backticks / "$(...)".
 */
function hasShellMetacharacters(command: string): boolean {
  return /[;&|`\n\r<>]|\$\(/.test(command);
}

/**
 * Blocks absolute paths and parent-directory traversal so a command that
 * otherwise matches the whitelist (e.g. "cat <path>") cannot read or affect
 * anything outside the cloned repository's working directory.
 */
function hasDangerousPathSegment(command: string): boolean {
  if (command.includes("..")) return true;
  return command.split(/\s+/).some((token) => token.startsWith("/") || token.startsWith("~"));
}

// Checked as substrings (case-insensitive) before the allow-list, so a
// pattern that would otherwise match (e.g. "git branch") can still be
// rejected for a denied suffix ("git branch -D main").
const DENIED_SUBSTRINGS = [
  "rm -rf",
  "rm -fr",
  "rm -r -f",
  "rm -f -r",
  "chmod",
  "chown",
  "sudo",
  "su -",
  "git push",
  "git remote",
  "git config",
  "git merge",
  "git rebase",
  "git reset --hard",
  "git clean",
  "git filter-branch",
  "git -c",
  "curl",
  "wget",
  "nc ",
  "ncat",
  "ssh ",
  "scp ",
  "telnet",
  "ftp ",
  "export ",
  "base64",
  "eval ",
  "exec ",
  "branch -d",
];

function findDeniedSubstring(command: string): string | undefined {
  const lower = command.toLowerCase();
  return DENIED_SUBSTRINGS.find((needle) => lower.includes(needle));
}

/**
 * "env"/"printenv" (the commands that dump every environment variable) are
 * checked as whole words, not substrings -- a plain substring match would
 * also reject ".env.example", "environment.md", or anything else that
 * merely contains the letters "env".
 */
function isEnvDumpCommand(command: string): boolean {
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase();
  return firstToken === "env" || firstToken === "printenv";
}

// Deliberately minimal: install/build/test for the common Node and Python
// toolchains, read-only git inspection, and basic file/text inspection.
// Nothing here can mutate git state, change permissions, reach the network,
// or read environment variables -- those are all caught by
// hasShellMetacharacters/hasDangerousPathSegment/findDeniedSubstring first.
const ALLOWED_COMMAND_PATTERNS: RegExp[] = [
  /^(npm|yarn|pnpm) (install|ci)$/,
  /^(npm|yarn|pnpm) run [\w:.-]+$/,
  /^(npm|yarn|pnpm) (test|build)$/,
  /^npx (tsc|vitest|jest|eslint|prettier)(\s+[\w.:=/-]+)*$/,
  /^tsc(\s+-p\s+[\w./-]+)?$/,
  /^node(\s+--test)?\s+[\w./*-]+$/,
  /^python3?\s+-m\s+pytest(\s+[\w./:=-]+)*$/,
  /^pip3?\s+install\s+-r\s+requirements\.txt$/,
  /^git (status|diff|log|show|branch)(\s+[\w.:=/-]+)*$/,
  /^(ls|pwd|find|grep|wc|head|tail|cat)(\s+[\w.:=*/-]+)*$/,
];

export interface BashVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Applies the same sensitive-file rules used for Read/Edit/Write (see
 * sensitiveFiles.ts) to every non-flag token in a Bash command, so e.g.
 * "cat id_rsa" or "grep foo .git/config" is denied the same way a Read
 * tool call for that path would be. This is a plain string check, not a
 * shell parser or a realpath resolution -- a symlink planted inside the
 * workspace under an innocuous name could still be dereferenced by `cat`
 * without tripping it (see the README's residual-risk note).
 */
function referencesSensitivePath(command: string): string | undefined {
  const tokens = command.split(/\s+/).filter(Boolean);
  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) continue;
    const verdict = classifySensitivity(token);
    if (verdict.sensitive) return verdict.reason;
  }
  return undefined;
}

export function evaluateBashCommand(rawCommand: string): BashVerdict {
  const command = rawCommand.trim();
  if (!command) return { allowed: false, reason: "Empty command." };
  if (hasShellMetacharacters(command)) {
    return { allowed: false, reason: "Command chaining, redirection, and substitution are not permitted." };
  }
  if (hasDangerousPathSegment(command)) {
    return { allowed: false, reason: "Absolute paths and parent-directory references are not permitted." };
  }
  if (isEnvDumpCommand(command)) {
    return { allowed: false, reason: "Commands that print environment variables are not permitted." };
  }
  const denied = findDeniedSubstring(command);
  if (denied) {
    return { allowed: false, reason: `Command contains a disallowed operation: "${denied.trim()}".` };
  }
  const sensitiveReason = referencesSensitivePath(command);
  if (sensitiveReason) {
    return { allowed: false, reason: sensitiveReason };
  }
  const isAllowed = ALLOWED_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
  if (!isAllowed) {
    return { allowed: false, reason: "Command is not on the allowed list." };
  }
  return { allowed: true };
}

/** True when `candidatePath` (relative or absolute) resolves to `workspaceRoot` or a descendant of it. */
export function isPathWithinWorkspace(candidatePath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(workspaceRoot, candidatePath);
  const relative = path.relative(workspaceRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves `absolutePath` through `fs.realpath`, tolerating a path that
 * doesn't exist yet (e.g. a Write target) by walking up to the nearest
 * existing ancestor, realpath-ing that, and reattaching the non-existing
 * suffix. Any other failure (permission denied, etc.) falls back to the
 * literal path rather than throwing out of a security check.
 */
async function realpathTolerant(absolutePath: string): Promise<string> {
  const suffix: string[] = [];
  let current = absolutePath;
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return suffix.length ? path.join(real, ...suffix.reverse()) : real;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return absolutePath;
      }
      const parent = path.dirname(current);
      if (parent === current) return absolutePath;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

export interface AccessVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * The full check behind every Read/Edit/Write/Glob/Grep path: containment
 * in the workspace, not a denied sensitive file, and -- after resolving
 * symlinks/junctions on both sides -- still true of the real path. A
 * symlink planted inside the workspace that points at ".env" or outside
 * the workspace entirely is caught by the second pass even though its own
 * name gives no hint.
 */
export async function checkWorkspacePath(candidatePath: string, workspaceRoot: string): Promise<AccessVerdict> {
  if (!isPathWithinWorkspace(candidatePath, workspaceRoot)) {
    return { allowed: false, reason: "Path is outside the repository workspace." };
  }
  const literalSensitivity = classifySensitivity(candidatePath);
  if (literalSensitivity.sensitive) {
    return { allowed: false, reason: literalSensitivity.reason };
  }

  const absoluteCandidate = path.resolve(workspaceRoot, candidatePath);
  const [realWorkspace, realCandidate] = await Promise.all([
    realpathTolerant(workspaceRoot),
    realpathTolerant(absoluteCandidate),
  ]);
  if (!isPathWithinWorkspace(realCandidate, realWorkspace)) {
    return { allowed: false, reason: "Path resolves outside the repository workspace (symlink or junction)." };
  }
  const realSensitivity = classifySensitivity(realCandidate);
  if (realSensitivity.sensitive) {
    return { allowed: false, reason: realSensitivity.reason };
  }
  return { allowed: true };
}

/**
 * The sole authority for what the implementation agent may do. Nothing here
 * is "auto-allowed" (see agent.ts's comment on why `allowedTools` is never
 * set) -- every tool call the model attempts is decided here, explicitly,
 * default-deny for anything this function doesn't recognize.
 */
export function createCanUseTool(workspaceRoot: string): CanUseTool {
  return async (toolName, input) => {
    switch (toolName) {
      case "Read":
      case "Edit":
      case "Write": {
        const filePath = typeof input.file_path === "string" ? input.file_path : undefined;
        if (!filePath) {
          return { behavior: "deny", message: `${toolName} requires a file_path.` };
        }
        const verdict = await checkWorkspacePath(filePath, workspaceRoot);
        if (!verdict.allowed) {
          return { behavior: "deny", message: verdict.reason ?? `${toolName} is not permitted for this path.` };
        }
        return { behavior: "allow" };
      }
      case "Glob":
      case "Grep": {
        const searchPath = typeof input.path === "string" ? input.path : undefined;
        if (searchPath) {
          const verdict = await checkWorkspacePath(searchPath, workspaceRoot);
          if (!verdict.allowed) {
            return { behavior: "deny", message: verdict.reason ?? `${toolName} is not permitted for this path.` };
          }
        }
        return { behavior: "allow" };
      }
      case "Bash": {
        if (input.dangerouslyDisableSandbox === true) {
          return { behavior: "deny", message: "Disabling the sandbox is never permitted." };
        }
        const command = typeof input.command === "string" ? input.command : "";
        const verdict = evaluateBashCommand(command);
        if (!verdict.allowed) {
          return { behavior: "deny", message: verdict.reason ?? "Command not permitted." };
        }
        return { behavior: "allow" };
      }
      default:
        return { behavior: "deny", message: `Tool "${toolName}" is not permitted for this agent.` };
    }
  };
}
