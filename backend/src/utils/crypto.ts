import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// ───────────── Contraseñas (scrypt, incluido en Node.js, sin dependencias nativas) ─────────────

const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

/** Devuelve "scrypt$N$r$p$salt$hash" (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFKC"), salt, KEY_LEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Política mínima de contraseñas del panel. Devuelve un mensaje de error o null. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (password.length > 200) return "La contraseña es demasiado larga.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "La contraseña debe combinar letras y números.";
  }
  return null;
}

// ───────────── Tokens ─────────────

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ───────────── Firma de webhooks de Meta (X-Hub-Signature-256) ─────────────

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(signatureHeader.slice("sha256=".length), expected);
}

export function signMetaPayload(rawBody: Buffer | string, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

// ───────────── Cifrado de credenciales (AES-256-GCM) ─────────────

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/** Acepta una clave hex de 64 caracteres, base64 de 32 bytes o cualquier texto (se deriva con SHA-256). */
export function deriveKey(secret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  const b64 = Buffer.from(secret, "base64");
  if (b64.length === 32 && /^[A-Za-z0-9+/=_-]+$/.test(secret)) return b64;
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string, key: Buffer): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(value: EncryptedValue, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** "sk-ant-…abcd": solo muestra el final de una credencial. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, Math.min(6, Math.floor(value.length / 4)))}…${value.slice(-4)}`;
}
