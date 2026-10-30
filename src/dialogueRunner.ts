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
  if (session.state !== "QUEUED") throw new Error("Session must be queued");
  let current = session;
  await store.save(current);
  try {
    while (true) {
      const provider = nextProvider(current);
      if (!provider) return current;
      const response = await adapter.ask(provider, buildDialoguePrompt(topic, current.turns));
      current = recordDialogueTurn(current, response);
      await store.save(current);
      if (current.state !== "RUNNING") return current;
    }
  } catch (error) {
    const failed: DialogueSession = { ...current, state: "FAILED" };
    await store.save(failed);
    throw error;
  }
}
