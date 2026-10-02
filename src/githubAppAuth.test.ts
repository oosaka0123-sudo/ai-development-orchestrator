import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createAppJwt,
  isGitHubAuthConfigured,
  resolveGitHubToken,
} from "./githubAppAuth.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

test("createAppJwt creates a short-lived app JWT", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const jwt = createAppJwt("12345", pem, now);
  const [, payloadPart] = jwt.split(".");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.equal(payload.iss, "12345");
  assert.equal(payload.iat, Math.floor(now / 1000) - 60);
  assert.equal(payload.exp, Math.floor(now / 1000) + 540);
});

test("static token remains a rollback-compatible fallback", async () => {
  assert.equal(await resolveGitHubToken({ githubToken: "legacy-token" }), "legacy-token");
});
test("mints a repository-scoped installation token when GitHub App credentials are present", async () => {
  let calledUrl = "";
  let calledBody = "";
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
  }) as typeof fetch;

  const config = {
    githubAppId: "12345",
    githubInstallationId: "67890",
    githubAppPrivateKey: pem,
  };
  const token = await resolveGitHubToken(config, {
    fetchFn,
    now: Date.UTC(2026, 9, 2, 12, 0, 0),
    repositories: ["example-repo"],
  });

  assert.equal(token, "installation-token");
  assert.match(calledUrl, /\/app\/installations\/67890\/access_tokens$/);
  assert.deepEqual(JSON.parse(calledBody), { repositories: ["example-repo"] });
  assert.equal(isGitHubAuthConfigured(config), true);
});

test("incomplete app configuration fails closed", async () => {
  await assert.rejects(
    () => resolveGitHubToken({ githubAppId: "12345" }),
    /not configured/,
  );
  assert.equal(isGitHubAuthConfigured({ githubAppId: "12345" }), false);
});
