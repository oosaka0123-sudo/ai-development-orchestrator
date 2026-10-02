import { sign } from "node:crypto";

export interface GitHubAuthConfig {
  githubToken?: string;
  githubAppId?: string;
  githubInstallationId?: string;
  githubAppPrivateKey?: string;
}

export interface GitHubAuthOptions {
  fetchFn?: typeof fetch;
  now?: number;
  repositories?: string[];
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppJwt(
  appId: string,
  privateKey: string,
  now = Date.now(),
): string {
  const nowSeconds = Math.floor(now / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  });
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function isGitHubAuthConfigured(config: GitHubAuthConfig): boolean {
  if (config.githubToken) return true;
  return Boolean(
    config.githubAppId
    && config.githubInstallationId
    && config.githubAppPrivateKey,
  );
}

export async function resolveGitHubToken(
  config: GitHubAuthConfig,
  options: GitHubAuthOptions = {},
): Promise<string> {
  if (config.githubToken) return config.githubToken;

  const appId = config.githubAppId?.trim();
  const installationId = config.githubInstallationId?.trim();
  const privateKey = config.githubAppPrivateKey;
  if (!appId || !installationId || !privateKey) {
    throw new Error("GitHub authentication is not configured");
  }

  const fetchFn = options.fetchFn ?? fetch;
  const jwt = createAppJwt(appId, privateKey, options.now ?? Date.now());
  const response = await fetchFn(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "ai-development-orchestrator",
        "content-type": "application/json",
      },
      body: options.repositories?.length
        ? JSON.stringify({ repositories: options.repositories })
        : undefined,
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub App token mint failed: ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error("GitHub App token response is incomplete");
  return data.token;
}
