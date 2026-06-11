import crypto from "node:crypto";

/**
 * Symmetric encryption for stored connection credentials
 * (NMI security key, Meta token, …). We never want these readable
 * in the database in plain text. Uses AES-256-GCM with a key from
 * CREDENTIALS_ENC_KEY (base64, 32 bytes).
 */
function key(): Buffer {
  const raw = process.env.CREDENTIALS_ENC_KEY;
  if (!raw) throw new Error("CREDENTIALS_ENC_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("CREDENTIALS_ENC_KEY must be 32 bytes, base64-encoded (try: openssl rand -base64 32)");
  }
  return buf;
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv.tag.ciphertext, all base64
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptJson<T = any>(blob: string): T {
  const [ivB64, tagB64, dataB64] = blob.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
