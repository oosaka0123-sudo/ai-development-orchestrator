import { Octokit } from "@octokit/rest";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { requireSecrets } from "./config.js";
import { runClaudeAgent } from "./agent.js";
import { commitAndPush, parseGitHubRepository, prepareWorkspace } from "./repository.js";

const activeRepositories = new Set<string>();

function branchName(): string {
  return `ai/task-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

function safeTitle(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 72) || "AI implementation task";
}

export async function planTask(config: AppConfig, repository: string, task: string) {
  requireSecrets(config);
  const ref = parseGitHubRepository(repository, config.defaultOwner);
  const key = `${ref.owner}/${ref.repo}`;
  if (activeRepositories.has(key)) throw new Error(`Repository ${key} already has an active task`);
  activeRepositories.add(key);
  try {
    const workspace = await prepareWorkspace(config.workspaceRoot, ref, branchName(), config.githubToken);
    const plan = await runClaudeAgent({ prompt: task, cwd: workspace, mode: "plan", apiKey: config.anthropicApiKey });
    return { repository: key, plan };
  } finally {
    activeRepositories.delete(key);
  }
}

export async function executeTask(config: AppConfig, repository: string, task: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Execution requires confirmed=true after the user approves the task");
  requireSecrets(config);
  const ref = parseGitHubRepository(repository, config.defaultOwner);
  const key = `${ref.owner}/${ref.repo}`;
  if (activeRepositories.has(key)) throw new Error(`Repository ${key} already has an active task`);
  activeRepositories.add(key);
  try {
    const branch = branchName();
    const workspace = await prepareWorkspace(config.workspaceRoot, ref, branch, config.githubToken);
    const summary = await runClaudeAgent({ prompt: task, cwd: workspace, mode: "execute", apiKey: config.anthropicApiKey });
    const commit = await commitAndPush(workspace, branch, safeTitle(task), config.githubToken);
    if (!commit.changed) return { repository: key, branch, changed: false, summary };

    const octokit = new Octokit({ auth: config.githubToken });
    const repoInfo = await octokit.repos.get({ owner: ref.owner, repo: ref.repo });
    const pull = await octokit.pulls.create({
      owner: ref.owner,
      repo: ref.repo,
      head: branch,
      base: repoInfo.data.default_branch,
      title: safeTitle(task),
      body: `## AI Development Orchestrator\n\n${summary}\n\nCommit: \`${commit.sha}\``,
    });
    return { repository: key, branch, changed: true, commit: commit.sha, pullRequest: pull.data.html_url, summary };
  } finally {
    activeRepositories.delete(key);
  }
}
