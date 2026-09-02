import assert from "node:assert/strict";
import test from "node:test";
import { repositorySchema, taskSchema } from "./inputSchemas.js";

test("repository accepts a normal owner/repo string", () => {
  assert.equal(repositorySchema.safeParse("owner/repo").success, true);
});

test("repository rejects an empty string", () => {
  assert.equal(repositorySchema.safeParse("").success, false);
});

test("repository rejects an unreasonably long string", () => {
  assert.equal(repositorySchema.safeParse("a".repeat(201)).success, false);
});

test("task rejects text shorter than 10 characters", () => {
  assert.equal(taskSchema("d").safeParse("too short").success, false);
});

test("task accepts a normal-length request", () => {
  assert.equal(taskSchema("d").safeParse("Add a health check endpoint with tests.").success, true);
});

test("task rejects text longer than 4000 characters", () => {
  assert.equal(taskSchema("d").safeParse("x".repeat(4001)).success, false);
});

test("task accepts exactly the maximum length", () => {
  assert.equal(taskSchema("d").safeParse("x".repeat(4000)).success, true);
});
