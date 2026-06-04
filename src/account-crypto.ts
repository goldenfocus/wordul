// src/account-crypto.ts — thin WebCrypto wrappers for account auth.
// Uses globalThis.crypto.subtle, which exists in BOTH the Workers runtime and the
// Node test env — so every function here is unit-testable without a Workers pool.
// No "cloudflare:workers" import: keep it that way so the tests stay runtime-free.

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const DERIVED_BITS = 256; // 32-byte hash
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hexToBytes: odd-length input (${hex.length})`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time compare of two equal-length hex strings. Unequal lengths → false fast
 *  (length is not secret). Equal lengths fold every char so timing doesn't leak position. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PBKDF2-SHA256 over the passphrase. Returns hex salt + hex hash. Pass `saltHex` to
 *  re-derive against a stored salt (verify); omit to mint a fresh salt (claim). */
export async function hashPassphrase(
  passphrase: string,
  saltHex?: string,
): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    key,
    DERIVED_BITS,
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

/** Re-derive against the stored salt and constant-time compare. */
export async function verifyPassphrase(
  passphrase: string,
  saltHex: string,
  expectedHashHex: string,
): Promise<boolean> {
  const { hash } = await hashPassphrase(passphrase, saltHex);
  return constantTimeEqualHex(hash, expectedHashHex);
}

/** 32 random bytes → hex. This is the RAW bearer token handed to the client ONCE. */
export function mintToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** SHA-256 of a token → hex. Only this hash is stored server-side (the key into sessions). */
export async function hashToken(token: string): Promise<string> {
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(dig));
}
