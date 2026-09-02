import path from "node:path";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

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
  "env",
  "printenv",
  "export ",
  ".env",
  "base64",
  "eval ",
  "exec ",
  "branch -d",
];

function findDeniedSubstring(command: string): string | undefined {
  const lower = command.toLowerCase();
  return DENIED_SUBSTRINGS.find((needle) => lower.includes(needle));
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

export function evaluateBashCommand(rawCommand: string): BashVerdict {
  const command = rawCommand.trim();
  if (!command) return { allowed: false, reason: "Empty command." };
  if (hasShellMetacharacters(command)) {
    return { allowed: false, reason: "Command chaining, redirection, and substitution are not permitted." };
  }
  if (hasDangerousPathSegment(command)) {
    return { allowed: false, reason: "Absolute paths and parent-directory references are not permitted." };
  }
  const denied = findDeniedSubstring(command);
  if (denied) {
    return { allowed: false, reason: `Command contains a disallowed operation: "${denied.trim()}".` };
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
        if (!filePath || !isPathWithinWorkspace(filePath, workspaceRoot)) {
          return {
            behavior: "deny",
            message: `${toolName} is restricted to files inside the repository workspace.`,
          };
        }
        return { behavior: "allow" };
      }
      case "Glob":
      case "Grep": {
        const searchPath = typeof input.path === "string" ? input.path : undefined;
        if (searchPath && !isPathWithinWorkspace(searchPath, workspaceRoot)) {
          return { behavior: "deny", message: `${toolName} is restricted to the repository workspace.` };
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
