import { z } from "zod";

// Boundary validation on the two free-text-ish inputs this server accepts.
// The lower bound keeps a task from being too vague to act on; the upper
// bound caps how much untrusted text -- and, indirectly, cost -- a single
// call can commit the agent to. Split into its own module (rather than
// living in server.ts) so it can be imported by a test without triggering
// server.ts's module-level loadConfig()/app.listen() side effects.
export const repositorySchema = z
  .string()
  .min(1)
  .max(200)
  .describe("GitHub URL, owner/repo, or repo name under the default owner");

export const taskSchema = (description: string) => z.string().min(10).max(4000).describe(description);
