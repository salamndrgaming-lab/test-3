import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Ingest API keys: `al_sk_<43 chars base64url>`. Only the sha256 hash is
 * stored; the plaintext is shown once at creation.
 */
export const API_KEY_PREFIX = "al_sk_";

/** Flash cookie carrying a just-created plaintext key to its one-time display. */
export const NEW_KEY_COOKIE = "al_new_api_key";

export interface GeneratedApiKey {
  /** Full plaintext key — display once, never persist. */
  plaintext: string;
  /** First 12 chars, stored for display ("al_sk_ab12…"). */
  keyPrefix: string;
  /** sha256 hex of the full plaintext — the stored lookup key. */
  keyHash: string;
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const plaintext = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return {
    plaintext,
    keyPrefix: plaintext.slice(0, API_KEY_PREFIX.length + 6),
    keyHash: hashApiKey(plaintext),
  };
}

/** Constant-time comparison of two hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Extracts the bearer key from an Authorization header, or null. */
export function bearerKey(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const key = match?.[1]?.trim();
  if (!key || !key.startsWith(API_KEY_PREFIX)) return null;
  return key;
}
