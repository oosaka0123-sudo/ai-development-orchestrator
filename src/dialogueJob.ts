import { FirestoreDialogueStore } from "./dialogueFirestore.js";
import { askDialogueModel } from "./dialogueModels.js";
import { estimateUsd, readPricing, requireBudget } from "./dialogueBudget.js";
import { runDialogue } from "./dialogueRunner.js";

export async function executeDialogueJob(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid session id");
  const store = new FirestoreDialogueStore(process.env.GOOGLE_CLOUD_PROJECT);
  const pricing = readPricing(process.env.COUNCIL_MODEL_PRICING_JSON);
  const session = await store.load(id);
  if (!session || !(await store.claim(id))) throw new Error("Session missing or already claimed");
  const settings = {
    openai: { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_COUNCIL_MODEL ?? "" },
    claude: { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_COUNCIL_MODEL ?? "" },
    gemini: { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_COUNCIL_MODEL ?? "" },
  };
  await runDialogue({ ...session, state: "RUNNING" }, session.topic, {
    async ask(provider, prompt, current) {
      if (!current) throw new Error("Session context required");
      const model = provider === "chatgpt" ? settings.openai.model : provider === "claude" ? settings.claude.model : settings.gemini.model;
      requireBudget(current, provider, model, pricing);
      const raw = await askDialogueModel(provider, prompt.slice(0, 12000), settings);
      return { provider, model: raw.model, response: raw.response,
        usage: { inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
          estimatedUsd: estimateUsd(pricing[model]!, raw.inputTokens, raw.outputTokens) } };
    },
  }, store);
}
if (process.argv[1]?.endsWith("dialogueJob.js")) {
  executeDialogueJob(process.argv[2] ?? "").catch(error => {
    console.error("Council job failed:", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  });
}
