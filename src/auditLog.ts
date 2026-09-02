/**
 * Structured, secret-free audit trail: one JSON line per event to stdout
 * (captured by whatever the host logs stdout to). Every call site controls
 * exactly which fields are included, so no caller can accidentally pass a
 * token or API key through this -- there is no generic "log this object"
 * entry point.
 */
export interface AuditEvent {
  event: "plan" | "execute_start" | "execute_result";
  repository: string;
  branch?: string;
  taskLength: number;
  timestamp?: string;
  changed?: boolean;
  filesChanged?: number;
  diffStat?: string;
  commit?: string;
  pullRequest?: string;
}

export function logAuditEvent(event: Omit<AuditEvent, "timestamp">, stream: NodeJS.WritableStream = process.stdout): void {
  const record: AuditEvent = { ...event, timestamp: new Date().toISOString() };
  stream.write(JSON.stringify({ audit: record }) + "\n");
}
