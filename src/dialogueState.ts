/** Pure, side-effect-free state machine for content development dialogue.
 * Provider calls, durable persistence and authorization belong to separate adapters.
 * This does NOT replace the existing 3-round reactivation Council.
 */
export type DialogueProvider = "chatgpt" | "claude" | "gemini";
export type DialogueState = "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "APPROVED" | "IMPLEMENTING" | "COMPLETED" | "FAILED" | "ABORTED_BY_BUDGET" | "CANCELLED";
export const CONTENT_TURN_ORDER: readonly DialogueProvider[] = ["chatgpt", "claude", "gemini", "chatgpt"];
export type DialogueUsage = { inputTokens: number; outputTokens: number; estimatedUsd: number };
export type DialogueTurn = { provider: DialogueProvider; model: string; response: string; usage: DialogueUsage };
export type DialogueSession = {
  id: string;
  project: string;
  state: DialogueState;
  turns: DialogueTurn[];
  maxEstimatedUsd: number;
};
export function startDialogue(id: string, project: string, maxEstimatedUsd: number): DialogueSession {
  if (!id || !/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(project)) throw new Error("Invalid session or project");
  if (!Number.isFinite(maxEstimatedUsd) || maxEstimatedUsd <= 0) throw new Error("Invalid budget");
  return { id, project, state: "QUEUED", turns: [], maxEstimatedUsd };
}
export function nextProvider(session: DialogueSession): DialogueProvider | null {
  if (session.state !== "QUEUED" && session.state !== "RUNNING") return null;
  return CONTENT_TURN_ORDER[session.turns.length] ?? null;
}
export function recordDialogueTurn(session: DialogueSession, turn: DialogueTurn): DialogueSession {
  if (nextProvider(session) !== turn.provider) throw new Error("Unexpected provider or closed session");
  if (!turn.model || !turn.response || !Number.isFinite(turn.usage.estimatedUsd) || turn.usage.estimatedUsd < 0
      || !Number.isSafeInteger(turn.usage.inputTokens) || turn.usage.inputTokens < 0
      || !Number.isSafeInteger(turn.usage.outputTokens) || turn.usage.outputTokens < 0) throw new Error("Invalid provider result");
  const turns = [...session.turns, turn];
  const cost = turns.reduce((sum, item) => sum + item.usage.estimatedUsd, 0);
  return { ...session, turns, state: cost > session.maxEstimatedUsd ? "ABORTED_BY_BUDGET" : turns.length === CONTENT_TURN_ORDER.length ? "WAITING_APPROVAL" : "RUNNING" };
}
export function cancelDialogue(session: DialogueSession): DialogueSession {
  if (["COMPLETED", "CANCELLED", "FAILED", "ABORTED_BY_BUDGET"].includes(session.state)) return session;
  return { ...session, state: "CANCELLED" };
}
