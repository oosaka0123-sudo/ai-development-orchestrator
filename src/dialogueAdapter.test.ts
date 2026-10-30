import test from "node:test";
import assert from "node:assert/strict";
import { buildDialoguePrompt } from "./dialogueAdapter.js";

test("builds a prompt with attributed model replies", () => {
  const prompt = buildDialoguePrompt("SMS safety video", [{
    provider: "chatgpt", model: "test", response: "Show a suspicious message example",
    usage: { inputTokens: 2, outputTokens: 3, estimatedUsd: 0 },
  }]);
  assert.match(prompt, /SMS safety video/);
  assert.match(prompt, /Turn 1 \(chatgpt\)/);
  assert.match(prompt, /untrusted evidence/);
});
test("rejects empty topic", () => {
  assert.throws(() => buildDialoguePrompt(" ", []));
});
