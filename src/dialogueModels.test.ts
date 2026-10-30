import test from "node:test";
import assert from "node:assert/strict";
import { askDialogueModel } from "./dialogueModels.js";
const settings = {
  openai: { apiKey: "test", model: "test-openai" },
  claude: { apiKey: "test", model: "test-claude" },
  gemini: { apiKey: "test", model: "test-gemini" },
};
test("OpenAI adapter preserves raw output and usage", async () => {
  const fake = (async () => new Response(JSON.stringify({ output: [{ content: [{ text: "OpenAI answer" }] }], usage: { input_tokens: 12, output_tokens: 3 } }), { status: 200 })) as typeof fetch;
  const reply = await askDialogueModel("chatgpt", "hello", settings, fake);
  assert.equal(reply.response, "OpenAI answer");
  assert.equal(reply.inputTokens, 12);
});
test("Claude adapter preserves raw output", async () => {
  const fake = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Claude answer" }], usage: { input_tokens: 7, output_tokens: 4 } }), { status: 200 })) as typeof fetch;
  assert.equal((await askDialogueModel("claude", "hello", settings, fake)).response, "Claude answer");
});
test("Gemini adapter preserves raw output", async () => {
  const fake = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini answer" }] } }], usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4 } }), { status: 200 })) as typeof fetch;
  assert.equal((await askDialogueModel("gemini", "hello", settings, fake)).response, "Gemini answer");
});
test("Gemini thinking tokens are counted for budget estimates", async () => {
  const fake = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Reasoned answer" }] } }],
    usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4, thoughtsTokenCount: 12 } }), { status: 200 })) as typeof fetch;
  const reply = await askDialogueModel("gemini", "hello", settings, fake);
  assert.equal(reply.outputTokens, 16);
});
test("HTTP errors do not fabricate model output", async () => {
  const fake = (async () => new Response("error", { status: 503 })) as typeof fetch;
  await assert.rejects(() => askDialogueModel("claude", "hello", settings, fake), /HTTP 503/);
});
