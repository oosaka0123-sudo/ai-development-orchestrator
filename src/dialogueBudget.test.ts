import test from "node:test";
import assert from "node:assert/strict";
import { BudgetExceededError, estimateUsd, readPricing, requireBudget } from "./dialogueBudget.js";
import { startDialogue } from "./dialogueState.js";
test("pricing is mandatory and checked", () => {
  assert.throws(() => readPricing(undefined));
  assert.throws(() => readPricing('{"m":{"inputUsdPerMillion":-1,"outputUsdPerMillion":1}}'));
});
test("estimated cost uses per-million-token prices", () => {
  assert.equal(estimateUsd({ inputUsdPerMillion: 2, outputUsdPerMillion: 4 }, 1000000, 1000000), 6);
});
test("preflight refuses a turn that cannot fit the budget", () => {
  const session = startDialogue("one", "owner/repo", 0.001);
  assert.throws(() => requireBudget(session, "chatgpt", "model", { model: { inputUsdPerMillion: 2, outputUsdPerMillion: 4 } }), BudgetExceededError);
});
