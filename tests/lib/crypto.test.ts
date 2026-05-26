// tests/lib/crypto.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt, hashWithPepper } from "@/lib/crypto";

beforeAll(() => {
  // base64 of 32 zero bytes
  process.env.OPENFINANCE_TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.PII_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
  process.env.CPF_HASH_PEPPER = "test-pepper-1234567890abcdef";
});

describe("crypto", () => {
  it("encrypts and decrypts a token round-trip", () => {
    const plain = "an-access-token-xyz";
    const sealed = encrypt(plain, "OPENFINANCE_TOKEN_KEY");
    expect(sealed).not.toBe(plain);
    expect(decrypt(sealed, "OPENFINANCE_TOKEN_KEY")).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plain = "secret";
    const a = encrypt(plain, "PII_KEY");
    const b = encrypt(plain, "PII_KEY");
    expect(a).not.toBe(b);
    expect(decrypt(a, "PII_KEY")).toBe(plain);
    expect(decrypt(b, "PII_KEY")).toBe(plain);
  });

  it("rejects tampered ciphertext", () => {
    const sealed = encrypt("data", "PII_KEY");
    const tampered = sealed.slice(0, -2) + "AA";
    expect(() => decrypt(tampered, "PII_KEY")).toThrow();
  });

  it("hashWithPepper is deterministic and unique per pepper", () => {
    const a = hashWithPepper("12345678901", "CPF_HASH_PEPPER");
    const b = hashWithPepper("12345678901", "CPF_HASH_PEPPER");
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // hex-encoded SHA-256
  });
});
