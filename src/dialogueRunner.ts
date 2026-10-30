import { BudgetExceededError } from "./dialogueBudget.js";
import { buildDialoguePrompt, type DialogueAdapter } from "./dialogueAdapter.js";
import { nextProvider, recordDialogueTurn, type DialogueSession } from "./dialogueState.js";

export interface DialogueStore {
  save(session: DialogueSession): Promise<void>;
}

export async function runDialogue(
  session: DialogueSession,
  topic: string,
  adapter: DialogueAdapter,
  store: DialogueStore,
): Promise<DialogueSession> {
  if (session.state !== "QUEUED" && session.state !== "RUNNING") throw new Error("Session must be queued");
  let current = session;
  await store.save(current);
  try {
    while (true) {
      const provider = nextProvider(current);
      if (!provider) return current;
      const prompt = buildDialoguePrompt(topic, current.turns).slice(0, 12000);
      const response = await adapter.ask(provider, prompt, current);
      current = recordDialogueTurn(current, { ...response, prompt });
      await store.save(current);
      if (current.state !== "RUNNING") return current;
    }
  } catch (error) {
    const failed: DialogueSession = { ...current, state: error instanceof BudgetExceededError ? "ABORTED_BY_BUDGET" : "FAILED" };
    await store.save(failed);
    throw error;
  }
}




