import assert from "node:assert/strict";
import test from "node:test";
import { classifySensitivity } from "./sensitiveFiles.js";

test("denies .env and its common variants", () => {
  for (const p of [".env", ".env.local", ".env.development", ".env.production", ".env.test", "config/.env"]) {
    assert.equal(classifySensitivity(p).sensitive, true, p);
  }
});

test("allows .env.example as a placeholder-only template", () => {
  assert.equal(classifySensitivity(".env.example").sensitive, false);
  assert.equal(classifySensitivity("config/.env.example").sensitive, false);
});

test("denies SSH private keys but not their public counterparts", () => {
  assert.equal(classifySensitivity("id_rsa").sensitive, true);
  assert.equal(classifySensitivity(".ssh/id_ed25519").sensitive, true);
  assert.equal(classifySensitivity("id_rsa.pub").sensitive, false);
});

test("denies certificate and key-material extensions", () => {
  for (const p of ["server.pem", "server.key", "cert.crt", "cert.cer", "keystore.jks", "vault.kdbx", "client.p12"]) {
    assert.equal(classifySensitivity(p).sensitive, true, p);
  }
});

test("denies files inside a .git directory at any depth", () => {
  for (const p of [".git/config", ".git/HEAD", "repo/.git/objects/aa/bb", ".git/credentials"]) {
    assert.equal(classifySensitivity(p).sensitive, true, p);
  }
});

test("denies credentials/secrets files by exact name or substring", () => {
  for (const p of ["credentials.json", "secrets.yaml", "aws-credentials.txt", "db_password.txt", "api_token.md"]) {
    assert.equal(classifySensitivity(p).sensitive, true, p);
  }
});

test("denies shell auth files (.npmrc, .netrc)", () => {
  assert.equal(classifySensitivity(".npmrc").sensitive, true);
  assert.equal(classifySensitivity(".netrc").sensitive, true);
});

test("allows ordinary source and doc files", () => {
  for (const p of ["src/index.ts", "README.md", "package.json", "src/permissions.test.ts", "docs/architecture.md"]) {
    assert.equal(classifySensitivity(p).sensitive, false, p);
  }
});

test("reasons never echo the input path or any file content", () => {
  const verdict = classifySensitivity(".env");
  assert.equal(typeof verdict.reason, "string");
  assert.doesNotMatch(verdict.reason ?? "", /\.env/);
});
