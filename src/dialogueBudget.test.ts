import test from "node:test";
import assert from "node:assert/strict";
import { BudgetExceededError, assertPricingNotExpired, estimateUsd, readPricing, requireBudget } from "./dialogueBudget.js";
import { startDialogue } from "./dialogueState.js";
test("pricing is mandatory and checked", () => {
  assert.throws(() => readPricing(undefined));
  assert.throws(() => readPricing('{"m":{"inputUsdPerMillion":-1,"outputUsdPerMillion":1}}'));
  assert.throws(() => readPricing('{}'));
  assert.throws(() => readPricing('{"m":{"inputUsdPerMillion":0,"outputUsdPerMillion":1}}'));
  assert.throws(() => readPricing('{"m":{"inputUsdPerMillion":1,"outputUsdPerMillion":0}}'));
});
test("estimated cost uses per-million-token prices", () => {
  assert.equal(estimateUsd({ inputUsdPerMillion: 2, outputUsdPerMillion: 4 }, 1000000, 1000000), 6);
});
test("preflight refuses a turn that cannot fit the budget", () => {
  const session = startDialogue("one", "owner/repo", 0.001);
  assert.throws(() => requireBudget(session, "chatgpt", "model", { model: { inputUsdPerMillion: 2, outputUsdPerMillion: 4 } }), BudgetExceededError);
});

test("2026 introductory Gemini pricing is allowed but rejected after expiry", () => {
  const rates = { "gemini-3.8-flash": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 } };
  assert.doesNotThrow(() => assertPricingNotExpired(rates, new Date("2026-10-30T00:00:00Z")));
  assert.throws(() => assertPricingNotExpired(rates, new Date("2027-01-01T00:00:00Z")), /expired/);
  assert.doesNotThrow(() => assertPricingNotExpired({
    "gemini-3.8-flash": { inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5 },
  }, new Date("2027-01-01T00:00:00Z")));
});
