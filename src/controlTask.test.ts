import test from "node:test";
import assert from "node:assert/strict";
import { buildControlTask, normalizeControlRepository, parseControlCommand } from "./controlTask.js";

test("accepts supported control commands", () => {
  assert.equal(parseControlCommand("continue"), "continue");
  assert.equal(parseControlCommand("resume"), "resume");
  assert.throws(() => parseControlCommand("deploy"));
});

test("normalizes repository within configured owner", () => {
  assert.equal(normalizeControlRepository("demo", "oosaka0123-sudo"), "oosaka0123-sudo/demo");
  assert.equal(normalizeControlRepository("oosaka0123-sudo/demo", "oosaka0123-sudo"), "oosaka0123-sudo/demo");
});

test("rejects repository outside configured owner or malformed input", () => {
  assert.throws(() => normalizeControlRepository("someone-else/demo", "oosaka0123-sudo"));
  assert.throws(() => normalizeControlRepository("owner/repo/extra", "oosaka0123-sudo"));
  assert.throws(() => normalizeControlRepository("../demo", "oosaka0123-sudo"));
});

test("control task preserves safety boundaries", () => {
  const task = buildControlTask("continue");
  assert.match(task, /Do not modify secrets/);
  assert.match(task, /Do not force-push, merge, or deploy/);
  assert.match(task, /human decision/);
  assert.match(task, /open Pull Requests/);
  assert.match(task, /source of truth/);
});
