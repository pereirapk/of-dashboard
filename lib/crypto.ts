// lib/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

type KeyName = "OPENFINANCE_TOKEN_KEY" | "PII_KEY";

function loadKey(name: KeyName): Buffer {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} env var is required`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must decode to 32 bytes`);
  }
  return key;
}

export function encrypt(plaintext: string, keyName: KeyName): string {
  const key = loadKey(keyName);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(sealedB64: string, keyName: KeyName): string {
  const key = loadKey(keyName);
  const buf = Buffer.from(sealedB64, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

type PepperName = "CPF_HASH_PEPPER" | "COUNTERPARTY_HASH_PEPPER";

export function hashWithPepper(value: string, pepperName: PepperName): string {
  const pepper = process.env[pepperName];
  if (!pepper) {
    throw new Error(`${pepperName} env var is required`);
  }
  return createHash("sha256").update(value).update(pepper).digest("hex");
}
