import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessToken,
  createAuthorizationCode,
  pkceChallenge,
  readAccessToken,
  readAuthorizationCode,
  secretsMatch,
} from "./oauth.js";

const secret = "unit-test-signing-key-material";
const now = 1_000_000;

test("authorization codes are signed, expire, and bind redirect/resource", () => {
  const payload = {
    redirectUri: "https://chatgpt.com/connector/oauth/callback-id",
    codeChallenge: pkceChallenge("verifier"),
    resource: "https://example.test/mcp",
    expiresAt: now + 300_000,
  };
  const code = createAuthorizationCode(payload, secret);
  assert.deepEqual(readAuthorizationCode(code, secret, now), payload);
  assert.equal(readAuthorizationCode(`${code}x`, secret, now), null);
  assert.equal(readAuthorizationCode(code, secret, payload.expiresAt + 1), null);
});

test("access tokens require signature, issuer, audience, scope, and expiry", () => {
  const expected = {
    issuer: "https://auth.example.test",
    audience: "https://api.example.test/mcp",
    scope: "mcp",
  };
  const token = createAccessToken({ ...expected, scope: "mcp", expiresAt: now + 3_600_000 }, secret);
  assert.ok(readAccessToken(token, secret, expected, now));
  assert.equal(readAccessToken(token, secret, { ...expected, audience: "https://other.test/mcp" }, now), null);
  assert.equal(readAccessToken(token, secret, { ...expected, scope: "admin" }, now), null);
  assert.equal(readAccessToken(token, "wrong-secret", expected, now), null);
  assert.equal(readAccessToken(token, secret, expected, now + 3_600_001), null);
});

test("PKCE uses the required S256 challenge", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("secret comparison handles equal and different-length inputs", () => {
  assert.equal(secretsMatch("expected-value", "expected-value"), true);
  assert.equal(secretsMatch("short", "a-much-longer-value"), false);
});
