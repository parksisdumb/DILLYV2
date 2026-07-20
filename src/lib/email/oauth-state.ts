import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed OAuth `state` to defend the Gmail connect flow against CSRF.
 *
 * State = base64url(json{uid, iat}) + "." + HMAC-SHA256 over that payload, keyed
 * by GMAIL_TOKEN_ENCRYPTION_KEY. On callback we verify the signature AND that the
 * embedded uid equals the current session user, so a code can't be redeemed into
 * someone else's account. State is short-lived (10 min).
 */

const MAX_AGE_MS = 10 * 60 * 1000;

function key(): Buffer {
  const raw = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing GMAIL_TOKEN_ENCRYPTION_KEY");
  return Buffer.from(raw, "base64");
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function signState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyState(state: string): { userId: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { uid, iat } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof uid !== "string" || typeof iat !== "number") return null;
    if (Date.now() - iat > MAX_AGE_MS) return null;
    return { userId: uid };
  } catch {
    return null;
  }
}
