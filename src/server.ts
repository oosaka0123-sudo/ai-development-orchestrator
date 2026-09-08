import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { repositorySchema, taskSchema } from "./inputSchemas.js";
import { logError } from "./logging.js";
import { executeTask, planTask } from "./orchestrator.js";
import {
  createAccessToken,
  createAuthorizationCode,
  pkceChallenge,
  readAccessToken,
  readAuthorizationCode,
  secretsMatch,
} from "./oauth.js";

const config = loadConfig();
const secrets = [config.githubToken, config.anthropicApiKey, config.authToken];
const publicBaseUrl = (process.env.PUBLIC_BASE_URL
  ?? "https://rss7-ai-orchestrator-415190643779.asia-northeast1.run.app").replace(/\/$/, "");
const oauthClientId = process.env.OAUTH_CLIENT_ID ?? "chatgpt-rss7";
const mcpResource = `${publicBaseUrl}/mcp`;

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "ai-development-orchestrator", version: "0.2.0" });

  server.registerTool("orchestrator_status", {
    description: "Check whether the orchestrator is configured. Never returns secret values.",
    inputSchema: {},
  }, async () => textResult({
    ok: true,
    anthropicConfigured: Boolean(config.anthropicApiKey),
    githubConfigured: Boolean(config.githubToken),
    defaultOwner: config.defaultOwner,
  }));

  server.registerTool("plan_repository_task", {
    description: "Read a GitHub repository and ask the implementation agent for a read-only plan. This tool never edits or pushes code.",
    inputSchema: {
      repository: repositorySchema,
      task: taskSchema("Complete implementation request and acceptance criteria"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ repository, task }) => textResult(await planTask(config, repository, task)));

  server.registerTool("execute_repository_task", {
    description: "Implement an approved task on a new branch, push it, and open a pull request. Never merges or deploys.",
    inputSchema: {
      repository: repositorySchema,
      task: taskSchema("Approved implementation request and acceptance criteria"),
      confirmed: z.literal(true).describe("Must be true only after explicit user approval"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ repository, task, confirmed }) => textResult(await executeTask(config, repository, task, confirmed)));

  return server;
}

const allowedHosts = (process.env.MCP_ALLOWED_HOSTS
  ?? "localhost,127.0.0.1,rss7-ai-orchestrator-415190643779.asia-northeast1.run.app")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts });
app.use(express.urlencoded({ extended: false }));

function value(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function html(valueToEscape: string): string {
  return valueToEscape.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function isAllowedRedirectUri(redirectUri: string): boolean {
  try {
    const parsed = new URL(redirectUri);
    return parsed.origin === "https://chatgpt.com"
      && parsed.pathname.startsWith("/connector/oauth/");
  } catch {
    return false;
  }
}

const authorizationServerMetadata = {
  issuer: publicBaseUrl,
  authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
  token_endpoint: `${publicBaseUrl}/oauth/token`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["mcp"],
};

app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json(authorizationServerMetadata);
});
function protectedResourceMetadata(_req: Request, res: Response) {
  res.json({
    resource: mcpResource,
    authorization_servers: [publicBaseUrl],
    scopes_supported: ["mcp"],
  });
}
app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);

app.get("/oauth/authorize", (req, res) => {
  const clientId = value(req.query.client_id);
  const redirectUri = value(req.query.redirect_uri);
  const responseType = value(req.query.response_type);
  const state = value(req.query.state);
  const codeChallenge = value(req.query.code_challenge);
  const codeChallengeMethod = value(req.query.code_challenge_method);
  const scope = value(req.query.scope) || "mcp";
  const resource = value(req.query.resource);

  if (clientId !== oauthClientId || responseType !== "code" || !state
    || !isAllowedRedirectUri(redirectUri) || !codeChallenge || codeChallengeMethod !== "S256"
    || scope !== "mcp" || resource !== mcpResource) {
    res.status(400).send("Invalid OAuth authorization request");
    return;
  }

  res.type("html").send(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RSS7 AI Orchestrator</title>
<style>body{font-family:system-ui,sans-serif;max-width:440px;margin:48px auto;padding:24px;color:#171717}
input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;font-size:16px}
button{background:#111;color:#fff;border:0;border-radius:8px}p{line-height:1.6;color:#555}</style></head>
<body><h1>RSS7 AI Orchestrator</h1><p>ChatGPTからClaude実装エージェントへの接続を許可します。MCP認証トークンを入力してください。</p>
<form method="post" action="/oauth/authorize">
<input type="password" name="access_key" autocomplete="current-password" aria-label="MCP認証トークン" required>
<input type="hidden" name="client_id" value="${html(clientId)}">
<input type="hidden" name="redirect_uri" value="${html(redirectUri)}">
<input type="hidden" name="state" value="${html(state)}">
<input type="hidden" name="code_challenge" value="${html(codeChallenge)}">
<input type="hidden" name="scope" value="${html(scope)}">
<input type="hidden" name="resource" value="${html(resource)}">
<button type="submit">接続を許可</button></form></body></html>`);
});

app.post("/oauth/authorize", (req, res) => {
  const accessKey = value(req.body.access_key);
  const clientId = value(req.body.client_id);
  const redirectUri = value(req.body.redirect_uri);
  const state = value(req.body.state);
  const codeChallenge = value(req.body.code_challenge);
  const scope = value(req.body.scope);
  const resource = value(req.body.resource);

  if (!secretsMatch(accessKey, config.authToken)) {
    res.status(401).send("認証トークンが正しくありません");
    return;
  }
  if (clientId !== oauthClientId || !state || !isAllowedRedirectUri(redirectUri) || !codeChallenge
    || scope !== "mcp" || resource !== mcpResource) {
    res.status(400).send("Invalid OAuth authorization request");
    return;
  }

  const code = createAuthorizationCode({
    redirectUri,
    codeChallenge,
    resource,
    expiresAt: Date.now() + 5 * 60 * 1000,
  }, config.authToken);
  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code);
  destination.searchParams.set("state", state);
  res.redirect(destination.toString());
});

app.post("/oauth/token", (req, res) => {
  res.set("Cache-Control", "no-store");
  const grantType = value(req.body.grant_type);
  const clientId = value(req.body.client_id);
  const redirectUri = value(req.body.redirect_uri);
  const codeVerifier = value(req.body.code_verifier);
  const resource = value(req.body.resource);
  const payload = readAuthorizationCode(value(req.body.code), config.authToken);
  const challenge = codeVerifier ? pkceChallenge(codeVerifier) : "";

  if (grantType !== "authorization_code" || clientId !== oauthClientId || !payload
    || payload.redirectUri !== redirectUri || payload.codeChallenge !== challenge
    || payload.resource !== resource || resource !== mcpResource) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }

  const expiresIn = 60 * 60;
  res.json({
    access_token: createAccessToken({
      issuer: publicBaseUrl,
      audience: mcpResource,
      scope: "mcp",
      expiresAt: Date.now() + expiresIn * 1000,
    }, config.authToken),
    token_type: "Bearer",
    scope: "mcp",
    expires_in: expiresIn,
  });
});

function authenticate(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (secretsMatch(token, config.authToken) || readAccessToken(token, config.authToken, {
    issuer: publicBaseUrl,
    audience: mcpResource,
    scope: "mcp",
  })) return next();
  res.set("WWW-Authenticate",
    `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource/mcp", scope="mcp"`);
  res.status(401).json({ error: "Unauthorized" });
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "ai-development-orchestrator" }));
app.use("/mcp", authenticate);
app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logError("mcp_request", error, secrets);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});
app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

app.listen(config.port, () => console.log(`AI Development Orchestrator listening on :${config.port}`));
