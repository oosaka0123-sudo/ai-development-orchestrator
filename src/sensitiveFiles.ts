/**
 * Single source of truth for which files/paths are always denied to the
 * implementation agent, regardless of which tool (Read/Edit/Write/Grep/Glob,
 * or a Bash command referencing a path) requests them, and regardless of
 * whether the path otherwise resolves inside the workspace. Every reason
 * string here is a fixed category label, never file content or a secret
 * value -- these are safe to log as-is.
 */

const SENSITIVE_EXACT_BASENAMES = new Set(
  [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    ".netrc",
    ".npmrc",
    ".pgpass",
    ".dockercfg",
    "credentials",
    "credentials.json",
    "secrets.json",
    "secrets.yaml",
    "secrets.yml",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "authorized_keys",
  ].map((name) => name.toLowerCase()),
);

// The one deliberate exception: a template with placeholder values only, by
// convention across this whole project (see .env.example in this repo).
const ALLOWED_EXCEPTIONS = new Set([".env.example", ".env.sample", ".env.template"]);

const SENSITIVE_EXTENSIONS = new Set(
  [".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der", ".jks", ".keystore", ".kdbx", ".ovpn", ".asc", ".gpg", ".ppk"].map(
    (ext) => ext.toLowerCase(),
  ),
);

// Broader net for names that don't fit the exact-name or extension lists
// (e.g. "aws-credentials.txt", "api_token.md", "db_password.txt").
const SENSITIVE_SUBSTRINGS = [
  "secret",
  "credential",
  "password",
  "passwd",
  "keystore",
  "private-key",
  "private_key",
  "apikey",
  "api-key",
  "api_key",
  "token",
].map((s) => s.toLowerCase());

export interface SensitivityVerdict {
  sensitive: boolean;
  reason?: string;
}

function basenameLower(normalizedPath: string): string {
  const parts = normalizedPath.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Classifies a path (relative or absolute, need not exist on disk) as
 * sensitive or not, by name/extension/location alone. Does not touch the
 * filesystem -- callers that need symlink-aware resolution should realpath
 * first and classify the result too (see permissions.ts::checkWorkspacePath).
 */
export function classifySensitivity(candidatePath: string): SensitivityVerdict {
  const normalized = candidatePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const base = basenameLower(normalized);

  if (ALLOWED_EXCEPTIONS.has(base)) return { sensitive: false };

  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    return { sensitive: true, reason: "Path is inside a .git directory (git internals/config/credentials)." };
  }

  if (base.startsWith(".env")) {
    return { sensitive: true, reason: "Path is an env file." };
  }

  if (SENSITIVE_EXACT_BASENAMES.has(base)) {
    return { sensitive: true, reason: "Path matches a denied sensitive filename." };
  }

  const dotIndex = base.lastIndexOf(".");
  const extension = dotIndex >= 0 ? base.slice(dotIndex) : "";
  if (extension && SENSITIVE_EXTENSIONS.has(extension)) {
    return { sensitive: true, reason: "Path has a denied sensitive file extension." };
  }

  if (SENSITIVE_SUBSTRINGS.some((needle) => base.includes(needle))) {
    return { sensitive: true, reason: "Filename indicates sensitive content." };
  }

  return { sensitive: false };
}
