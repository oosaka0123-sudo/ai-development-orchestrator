import test from "node:test";
import assert from "node:assert/strict";
import { startDialogue, nextProvider, recordDialogueTurn, cancelDialogue, CONTENT_TURN_ORDER } from "./dialogueState.js";

const reply = (provider: "chatgpt" | "claude" | "gemini", cost = 0.01) => ({
  provider, model: "test-model", response: "provider-authored reply",
  usage: { inputTokens: 10, outputTokens: 20, estimatedUsd: cost },
});
test("four turns are ordered and stop before implementation", () => {
  let s = startDialogue("test-1", "oosaka0123-sudo/otona-smart-ai", 1);
  for (const provider of CONTENT_TURN_ORDER) {
    assert.equal(nextProvider(s), provider);
    s = recordDialogueTurn(s, reply(provider));
  }
  assert.equal(s.state, "WAITING_APPROVAL");
  assert.equal(nextProvider(s), null);
  assert.throws(() => recordDialogueTurn(s, reply("claude")));
});
test("wrong provider is rejected without mutation", () => {
  const s = startDialogue("test-2", "oosaka0123-sudo/otona-smart-ai", 1);
  assert.throws(() => recordDialogueTurn(s, reply("gemini")));
  assert.equal(s.turns.length, 0);
});
test("budget breach stops additional calls", () => {
  const s = recordDialogueTurn(startDialogue("test-3", "oosaka0123-sudo/otona-smart-ai", 0.005), reply("chatgpt", 0.01));
  assert.equal(s.state, "ABORTED_BY_BUDGET");
  assert.equal(nextProvider(s), null);
});
test("cancel blocks new turns", () => {
  const s = cancelDialogue(startDialogue("test-4", "oosaka0123-sudo/otona-smart-ai", 1));
  assert.equal(s.state, "CANCELLED");
  assert.equal(nextProvider(s), null);
});
test("invalid usage and budget rejected", () => {
  assert.throws(() => startDialogue("x", "owner/repo", 0));
  const s = startDialogue("x", "owner/repo", 1);
  assert.throws(() => recordDialogueTurn(s, { ...reply("chatgpt"), usage: { inputTokens: -1, outputTokens: 2, estimatedUsd: 0 } }));
});
