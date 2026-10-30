import test from "node:test";
import assert from "node:assert/strict";
import { runDialogue } from "./dialogueRunner.js";
import { startDialogue, type DialogueSession } from "./dialogueState.js";

test("four real adapter invocations are ordered and persisted", async () => {
  const called: string[] = [];
  const saved: DialogueSession[] = [];
  const result = await runDialogue(startDialogue("one", "owner/repo", 1), "video", {
    async ask(provider, prompt) {
      called.push(provider);
      if (called.length > 1) assert.match(prompt, /Turn 1 \(chatgpt\)/);
      return { provider, model: "mock", response: provider + " response", usage: { inputTokens: 2, outputTokens: 3, estimatedUsd: 0.01 } };
    },
  }, { async save(s) { saved.push(structuredClone(s)); } });
  assert.deepEqual(called, ["chatgpt", "claude", "gemini", "chatgpt"]);
  assert.equal(result.state, "WAITING_APPROVAL");
  assert.equal(saved.at(-1)?.state, "WAITING_APPROVAL");
  assert.equal(saved.at(-1)?.turns.length, 4);
});

test("budget stop prevents further provider calls", async () => {
  let calls = 0;
  const result = await runDialogue(startDialogue("two", "owner/repo", 0.005), "video", {
    async ask(provider) {
      calls++;
      return { provider, model: "mock", response: "ok", usage: { inputTokens: 2, outputTokens: 3, estimatedUsd: 0.01 } };
    },
  }, { async save() {} });
  assert.equal(result.state, "ABORTED_BY_BUDGET");
  assert.equal(calls, 1);
});
