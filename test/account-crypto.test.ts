import { describe, it, expect } from "vitest";
import {
  hashPassphrase,
  verifyPassphrase,
  mintToken,
  hashToken,
  constantTimeEqualHex,
} from "../src/account-crypto.ts";

describe("hashPassphrase / verifyPassphrase", () => {
  it("verifies the correct passphrase and rejects a wrong one", async () => {
    const phrase = "wordul amber otter glides past meadow";
    const { salt, hash } = await hashPassphrase(phrase);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);   // 16 bytes hex
    expect(hash).toMatch(/^[0-9a-f]{64}$/);   // 32 bytes hex
    expect(await verifyPassphrase(phrase, salt, hash)).toBe(true);
    expect(await verifyPassphrase("wordul amber otter glides past river", salt, hash)).toBe(false);
  });

  it("uses a fresh salt each call (same phrase → different salt+hash)", async () => {
    const a = await hashPassphrase("wordul a b c d e");
    const b = await hashPassphrase("wordul a b c d e");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("honours an explicit salt (deterministic derivation)", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    const a = await hashPassphrase("wordul a b c d e", salt);
    const b = await hashPassphrase("wordul a b c d e", salt);
    expect(a.hash).toBe(b.hash);
  });
});

describe("session tokens", () => {
  it("mints a 32-byte (64 hex char) random token", () => {
    const t1 = mintToken();
    const t2 = mintToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it("hashes a token to a stable 64-hex sha256", async () => {
    const t = mintToken();
    expect(await hashToken(t)).toBe(await hashToken(t));
    expect(await hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("constantTimeEqualHex", () => {
  it("returns true only for equal-length equal strings", () => {
    expect(constantTimeEqualHex("abcd", "abcd")).toBe(true);
    expect(constantTimeEqualHex("abcd", "abce")).toBe(false);
    expect(constantTimeEqualHex("abcd", "abc")).toBe(false);
  });
});
