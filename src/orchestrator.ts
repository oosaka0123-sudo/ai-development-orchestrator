import { Octokit } from "@octokit/rest";
import { randomUUID } from "node:crypto";
import { logAuditEvent } from "./auditLog.js";
import type { AppConfig } from "./config.js";
import { requireSecrets } from "./config.js";
import { resolveGitHubToken } from "./githubAppAuth.js";
import { safeErrorText } from "./logging.js";
import { runClaudeAgent } from "./agent.js";
import {
  assertSafeBranchName,
  commitAndPush,
  diffStat,
  getHeadSha,
  parseGitHubRepository,
  prepareWorkspace,
} from "./repository.js";

const activeRepositories = new Set<string>();

function branchName(): string {
  return `ai/task-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

function safeTitle(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 72) || "AI implementation task";
}

/** Every caught error is re-thrown through this before leaving the orchestrator, so neither the
 * MCP caller nor anything logging it downstream can ever see a raw token value. */
function sanitize(error: unknown, config: AppConfig, extraSecrets: string[] = []): Error {
  const message = safeErrorText(error, [
    config.githubToken,
    config.githubAppPrivateKey,
    config.anthropicApiKey,
    config.authToken,
    ...extraSecrets,
  ].filter((value): value is string => Boolean(value)));
  return new Error(message);
}

export async function planTask(config: AppConfig, repository: string, task: string) {
  requireSecrets(config);
  let githubToken = "";
  const ref = parseGitHubRepository(repository, config.defaultOwner);
  const key = `${ref.owner}/${ref.repo}`;
  if (activeRepositories.has(key)) throw new Error(`Repository ${key} already has an active task`);
  activeRepositories.add(key);
  try {
    githubToken = await resolveGitHubToken(config, { repositories: [ref.repo] });
    const branch = branchName();
    assertSafeBranchName(branch);
    logAuditEvent({ event: "plan", repository: key, taskLength: task.length });
    const workspace = await prepareWorkspace(config.workspaceRoot, ref, branch, githubToken);
    const plan = await runClaudeAgent({ prompt: task, cwd: workspace, mode: "plan", apiKey: config.anthropicApiKey });
    return { repository: key, plan };
  } catch (error) {
    throw sanitize(error, config, [githubToken]);
  } finally {
    activeRepositories.delete(key);
  }
}

export async function executeTask(config: AppConfig, repository: string, task: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Execution requires confirmed=true after the user approves the task");
  requireSecrets(config);
  let githubToken = "";
  const ref = parseGitHubRepository(repository, config.defaultOwner);
  const key = `${ref.owner}/${ref.repo}`;
  if (activeRepositories.has(key)) throw new Error(`Repository ${key} already has an active task`);
  activeRepositories.add(key);
  try {
    githubToken = await resolveGitHubToken(config, { repositories: [ref.repo] });
    const branch = branchName();
    assertSafeBranchName(branch);
    logAuditEvent({ event: "execute_start", repository: key, branch, taskLength: task.length });

    const workspace = await prepareWorkspace(config.workspaceRoot, ref, branch, githubToken);
    const baseSha = await getHeadSha(workspace, githubToken);
    const summary = await runClaudeAgent({ prompt: task, cwd: workspace, mode: "execute", apiKey: config.anthropicApiKey });
    const commit = await commitAndPush(workspace, branch, safeTitle(task), githubToken);

    if (!commit.changed) {
      logAuditEvent({ event: "execute_result", repository: key, branch, taskLength: task.length, changed: false });
      return { repository: key, branch, changed: false, summary };
    }

    const changeSummary = await diffStat(workspace, baseSha, commit.sha, githubToken);
    const filesChanged = changeSummary ? changeSummary.trim().split("\n").length : 0;

    const octokit = new Octokit({ auth: githubToken });
    const repoInfo = await octokit.repos.get({ owner: ref.owner, repo: ref.repo });
    const pull = await octokit.pulls.create({
      owner: ref.owner,
      repo: ref.repo,
      head: branch,
      base: repoInfo.data.default_branch,
      title: safeTitle(task),
      body: `## AI Development Orchestrator\n\n${summary}\n\n### Diff summary\n\n\`\`\`\n${changeSummary}\n\`\`\`\n\nCommit: \`${commit.sha}\``,
    });

    logAuditEvent({
      event: "execute_result",
      repository: key,
      branch,
      taskLength: task.length,
      changed: true,
      filesChanged,
      diffStat: changeSummary,
      commit: commit.sha,
      pullRequest: pull.data.html_url,
    });

    return { repository: key, branch, changed: true, commit: commit.sha, pullRequest: pull.data.html_url, summary };
  } catch (error) {
    throw sanitize(error, config, [githubToken]);
  } finally {
    activeRepositories.delete(key);
  }
}
