import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RepositoryRef {
  owner: string;
  repo: string;
  cloneUrl: string;
}

export function parseGitHubRepository(value: string, defaultOwner: string): RepositoryRef {
  const normalized = value.trim().replace(/\.git$/, "");
  let owner: string;
  let repo: string;

  if (normalized.startsWith("https://github.com/")) {
    const parts = new URL(normalized).pathname.split("/").filter(Boolean);
    if (parts.length !== 2) throw new Error("GitHub URL must identify exactly one repository");
    [owner, repo] = parts;
  } else if (normalized.includes("/")) {
    [owner, repo] = normalized.split("/");
  } else {
    owner = defaultOwner;
    repo = normalized;
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Invalid GitHub owner or repository name");
  }
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

const GENERATED_BRANCH_NAME_RE = /^ai\/task-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

/**
 * Invariant check on the orchestrator's own generated branch name -- there
 * is no user-supplied branch input today, but every branch name reaches
 * `git checkout -b`/`git push`, so this is asserted rather than assumed
 * before it does, and never allows "main"/"master" or anything shaped like
 * a flag (e.g. "--force") to reach a git command as a branch argument.
 */
export function assertSafeBranchName(branch: string): void {
  if (!GENERATED_BRANCH_NAME_RE.test(branch)) {
    throw new Error(`Generated branch name failed validation: ${branch}`);
  }
}

function gitEnv(token?: string): NodeJS.ProcessEnv {
  if (!token) return process.env;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

async function git(args: string[], cwd: string, token?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: gitEnv(token),
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function prepareWorkspace(
  root: string,
  ref: RepositoryRef,
  branch: string,
  token?: string,
): Promise<string> {
  await mkdir(root, { recursive: true });
  const target = path.join(root, `${ref.owner}--${ref.repo}`);
  await rm(target, { recursive: true, force: true });
  await git(["clone", "--depth=1", ref.cloneUrl, target], root, token);
  await git(["checkout", "-b", branch], target, token);
  return target;
}

export async function commitAndPush(
  cwd: string,
  branch: string,
  message: string,
  token: string,
): Promise<{ sha: string; changed: boolean }> {
  const status = await git(["status", "--porcelain"], cwd, token);
  if (!status) return { sha: await git(["rev-parse", "HEAD"], cwd, token), changed: false };
  await git(["add", "--all"], cwd, token);
  await git(["-c", "user.name=AI Development Orchestrator", "-c", "user.email=orchestrator@users.noreply.github.com", "commit", "-m", message], cwd, token);
  await git(["push", "--set-upstream", "origin", branch], cwd, token);
  return { sha: await git(["rev-parse", "HEAD"], cwd, token), changed: true };
}

/** HEAD's commit SHA -- call this right after `prepareWorkspace` to capture the pre-implementation baseline for `diffStat`. */
export async function getHeadSha(cwd: string, token?: string): Promise<string> {
  return git(["rev-parse", "HEAD"], cwd, token);
}

/** `git diff --stat` between two commits, for recording what the agent actually changed. */
export async function diffStat(cwd: string, baseSha: string, headSha: string, token?: string): Promise<string> {
  if (baseSha === headSha) return "";
  return git(["diff", "--stat", baseSha, headSha], cwd, token);
}
