import { Firestore } from "@google-cloud/firestore";
import type { DialogueSession } from "./dialogueState.js";
import type { DialogueStore } from "./dialogueRunner.js";

export class FirestoreDialogueStore implements DialogueStore {
  private readonly collection;
  constructor(projectId?: string) {
    this.collection = new Firestore(projectId ? { projectId } : {}).collection("council_sessions");
  }
  async create(session: DialogueSession, topic: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const daily = this.collection.firestore.collection("council_daily_limits").doc(today);
    const ref = this.collection.doc(session.id);
    await this.collection.firestore.runTransaction(async transaction => {
      const counter = await transaction.get(daily);
      const count = counter.data()?.count ?? 0;
      if (count >= 5) throw new Error("Daily council limit reached");
      transaction.create(ref, { ...session, topic, updatedAt: new Date().toISOString() });
      transaction.set(daily, { count: count + 1, date: today });
    });
  }
  async save(session: DialogueSession): Promise<void> {
    await this.collection.doc(session.id).set({ ...session, updatedAt: new Date().toISOString() }, { merge: true });
  }
  async load(id: string): Promise<(DialogueSession & { topic: string }) | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (!data) return null;
    return { id: data.id, project: data.project, state: data.state, turns: data.turns, maxEstimatedUsd: data.maxEstimatedUsd, topic: data.topic };
  }
  async claim(id: string): Promise<boolean> {
    const ref = this.collection.doc(id);
    return this.collection.firestore.runTransaction(async transaction => {
      const doc = await transaction.get(ref);
      if (!doc.exists || doc.data()?.state !== "QUEUED") return false;
      transaction.update(ref, { state: "RUNNING", updatedAt: new Date().toISOString() });
      return true;
    });
  }
}
