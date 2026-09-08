import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type SignedPayload = Record<string, unknown> & { expiresAt: number };

export type AuthorizationCodePayload = SignedPayload & {
  redirectUri: string;
  codeChallenge: string;
  resource: string;
};

export type AccessTokenPayload = SignedPayload & {
  issuer: string;
  audience: string;
  scope: "mcp";
};

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function secretsMatch(supplied: string, expected: string): boolean {
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function encode(payload: SignedPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function decode<T extends SignedPayload>(token: string, secret: string, now: number): T | null {
  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;

  const expectedSignature = sign(encodedPayload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as T;
    return Number.isFinite(payload.expiresAt) && payload.expiresAt >= now ? payload : null;
  } catch {
    return null;
  }
}

export function createAuthorizationCode(payload: AuthorizationCodePayload, secret: string): string {
  return encode(payload, secret);
}

export function readAuthorizationCode(code: string, secret: string, now = Date.now()): AuthorizationCodePayload | null {
  const payload = decode<AuthorizationCodePayload>(code, secret, now);
  if (!payload || !payload.redirectUri || !payload.codeChallenge || !payload.resource) return null;
  return payload;
}

export function createAccessToken(payload: AccessTokenPayload, secret: string): string {
  return encode(payload, secret);
}

export function readAccessToken(token: string, secret: string, expected: {
  issuer: string;
  audience: string;
  scope: string;
}, now = Date.now()): AccessTokenPayload | null {
  const payload = decode<AccessTokenPayload>(token, secret, now);
  if (!payload || payload.issuer !== expected.issuer || payload.audience !== expected.audience
    || payload.scope !== expected.scope) return null;
  return payload;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
