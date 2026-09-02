import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { executeTask, planTask } from "./orchestrator.js";

const config = loadConfig();

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "ai-development-orchestrator", version: "0.1.0" });

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
      repository: z.string().describe("GitHub URL, owner/repo, or repo name under the default owner"),
      task: z.string().min(10).describe("Complete implementation request and acceptance criteria"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ repository, task }) => textResult(await planTask(config, repository, task)));

  server.registerTool("execute_repository_task", {
    description: "Implement an approved task on a new branch, push it, and open a pull request. Never merges or deploys.",
    inputSchema: {
      repository: z.string().describe("GitHub URL, owner/repo, or repo name under the default owner"),
      task: z.string().min(10).describe("Approved implementation request and acceptance criteria"),
      confirmed: z.literal(true).describe("Must be true only after explicit user approval"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ repository, task, confirmed }) => textResult(await executeTask(config, repository, task, confirmed)));

  return server;
}

const app = createMcpExpressApp();

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (req.headers.authorization === `Bearer ${config.authToken}`) return next();
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
    console.error(error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});
app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

app.listen(config.port, () => console.log(`AI Development Orchestrator listening on :${config.port}`));
