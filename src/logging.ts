/** Replaces every occurrence of each secret value with a fixed marker. */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out;
}

/** Renders an unknown error as a message/stack string with all known secret values redacted. */
export function safeErrorText(error: unknown, secrets: Array<string | undefined>): string {
  const raw = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return redact(raw, secrets);
}

/**
 * Logs to stderr with every known secret value redacted first. Use this
 * instead of `console.error(error)` anywhere a git/GitHub API error (which
 * can embed request headers or command output) might otherwise reach the
 * server's logs unredacted.
 */
export function logError(context: string, error: unknown, secrets: Array<string | undefined>): void {
  console.error(`[${context}]`, safeErrorText(error, secrets));
}
