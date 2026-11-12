import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Server secret: FOLIO_SECRET, or a key file created on first run (never committed). */
function loadSecret(): Buffer {
  if (process.env.FOLIO_SECRET) return crypto.createHash("sha256").update(process.env.FOLIO_SECRET).digest();
  if (process.env.VERCEL) throw new Error("FOLIO_SECRET is not set. Add it in the Vercel project settings (any long random string).");
  const file = path.resolve("data/secret.key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}
const SECRET = loadSecret();

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/** AES-256-GCM for third-party API keys at rest. */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", SECRET, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    const [iv, tag, body] = enc.split(".").map((s) => Buffer.from(s, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", SECRET, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch { return null; }
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return new Promise((res, rej) =>
    crypto.scrypt(password, salt, 32, SCRYPT, (e, key) => (e ? rej(e) : res(`scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`))));
}
export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key ?? "", "base64url");
  return new Promise((res) =>
    crypto.scrypt(password, Buffer.from(salt ?? "", "base64url"), 32, SCRYPT, (e, got) =>
      res(!e && got.length === expected.length && crypto.timingSafeEqual(got, expected))));
}
