import type { DialogueProvider, DialogueSession } from "./dialogueState.js";
export class BudgetExceededError extends Error {}
export type ModelRate = { inputUsdPerMillion: number; outputUsdPerMillion: number };
export type Pricing = Record<string, ModelRate>;
export function readPricing(raw: string | undefined): Pricing {
  if (!raw) throw new Error("COUNCIL_MODEL_PRICING_JSON is required");
  const pricing = JSON.parse(raw) as Pricing;
  if (!pricing || typeof pricing !== "object") throw new Error("Invalid pricing");
  for (const value of Object.values(pricing)) {
    if (!value || !Number.isFinite(value.inputUsdPerMillion) || value.inputUsdPerMillion < 0 ||
      !Number.isFinite(value.outputUsdPerMillion) || value.outputUsdPerMillion < 0) throw new Error("Invalid price entry");
  }
  return pricing;
}
export function estimateUsd(rate: ModelRate, inputTokens: number, outputTokens: number): number {
  return (inputTokens * rate.inputUsdPerMillion + outputTokens * rate.outputUsdPerMillion) / 1_000_000;
}
export function requireBudget(session: DialogueSession, provider: DialogueProvider, model: string, pricing: Pricing): void {
  const rate = pricing[model];
  if (!rate) throw new Error("Missing pricing for model " + provider);
  const spent = session.turns.reduce((sum, turn) => sum + turn.usage.estimatedUsd, 0);
  const reserved = estimateUsd(rate, 12000, 1500);
  if (spent + reserved > session.maxEstimatedUsd) throw new BudgetExceededError("Session budget cannot cover next turn");
}
