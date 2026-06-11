/**
 * Lightweight single-operator gate. This is a personal app, so instead
 * of full multi-user auth we use one shared APP_PASSWORD and a signed
 * cookie. The cookie value is an HMAC of a constant, so it can't be
 * forged without APP_SECRET.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) so it works in both
 * the Edge runtime (middleware) and the Node runtime (route handlers).
 */
export const SESSION_COOKIE = "jarvis_session";

function secret(): string {
  return process.env.APP_SECRET || process.env.APP_PASSWORD || "dev-insecure-secret";
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare (length-independent enough for our purposes). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sessionToken(): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("jarvis-authed-v1"));
  return toHex(sig);
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await sessionToken();
  return safeEqual(token, expected);
}

export function passwordMatches(input: string): boolean {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true; // no password configured → open (dev)
  return safeEqual(input, pw);
}

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}
