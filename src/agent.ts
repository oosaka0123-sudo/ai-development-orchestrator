import { query } from "@anthropic-ai/claude-agent-sdk";

export async function runClaudeAgent(input: {
  prompt: string;
  cwd: string;
  mode: "plan" | "execute";
  apiKey: string;
}): Promise<string> {
  const execute = input.mode === "execute";
  const parts: string[] = [];
  const stream = query({
    prompt: input.prompt,
    options: {
      cwd: input.cwd,
      maxTurns: execute ? 40 : 12,
      model: "sonnet",
      tools: execute
        ? ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
        : ["Read", "Glob", "Grep"],
      allowedTools: execute
        ? ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
        : ["Read", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      env: { ...process.env, ANTHROPIC_API_KEY: input.apiKey },
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: execute
          ? "You are the implementation engineer. Work only inside the current repository. Never push, merge, expose secrets, or modify git remotes. Inspect first, make the requested change, run relevant tests, and summarize exactly what changed."
          : "You are a read-only technical planner. Inspect the repository and return a concrete implementation plan. Do not edit files or run mutation commands.",
      },
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") parts.push(block.text);
      }
    }
    if (message.type === "result" && message.subtype !== "success") {
      throw new Error(`Claude agent failed: ${message.subtype}`);
    }
  }
  return parts.join("\n").trim();
}
