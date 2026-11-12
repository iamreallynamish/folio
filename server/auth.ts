import type { Request, Response, NextFunction } from "express";
import { all, get, run, insert, now, tx } from "./db.js";
import { sha256, randomToken, hashPassword, verifyPassword } from "./crypto.js";
import { DEFAULT_CATEGORIES } from "../shared/categories.js";
import { CURRENCIES } from "../shared/money.js";

const COOKIE = "folio_session";
const SESSION_DAYS = 30;
const PROD = process.env.NODE_ENV === "production";

export interface User {
  id: number; email: string; name: string; base_currency: string; monthly_budget_minor: number | null;
  alert_threshold: number; last_reviewed_at: string; av_key_enc: string | null; anthropic_key_enc: string | null;
  ingest_token_hash: string | null; created_at: string; pass_hash: string; onboarded_at: string | null;
}
declare global { namespace Express { interface Request { user: User } } }

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

/** The cards this instance is set up for; balances stay unknown until a bank message states one. */
const STARTER_CARDS = [
  { bank: "ICICI Bank", card_type: "Student Forex Prepaid Card", last4: "0817", currency: "JPY", theme: "icici-student" },
  { bank: "Axis Bank", card_type: "Privilege Credit Card", last4: "7117", currency: "JPY", theme: "axis-privilege" },
];

/**
 * Rate limiter for credential endpoints, kept in the database so it holds across
 * serverless instances and cold starts.
 */
async function limit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  await run("DELETE FROM rate_hits WHERE key = ? AND at < ?", key, t - windowMs);
  const n = (await get<{ n: number }>("SELECT COUNT(*) n FROM rate_hits WHERE key = ?", key))!.n;
  if (n >= max) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
  await run("INSERT INTO rate_hits(key, at) VALUES (?, ?)", key, t);
}

function cookieOf(req: Request): string | null {
  const m = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
async function startSession(res: Response, userId: number) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await run("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)", sha256(token), userId, expires.toISOString(), now());
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${PROD ? "; Secure" : ""}`);
}

export function publicUser(u: User) {
  return {
    id: u.id, email: u.email, name: u.name, baseCurrency: u.base_currency, monthlyBudgetMinor: u.monthly_budget_minor,
    alertThreshold: u.alert_threshold, lastReviewedAt: u.last_reviewed_at,
    hasMarketKey: !!u.av_key_enc, hasAssistantKey: !!u.anthropic_key_enc, hasIngestToken: !!u.ingest_token_hash, onboarded: !!u.onboarded_at,
  };
}

/** State-changing requests must carry a custom header, which a cross-site form cannot send. */
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path.startsWith("/ingest/")) return next();
  if (req.get("X-Folio") !== "1") return next(new HttpError(403, "Missing request header."));
  next();
}

export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
  const token = cookieOf(req);
  const row = token && await get<User>(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?", sha256(token), now());
  if (!row) return next(new HttpError(401, "Sign in to continue."));
  req.user = row;
  next();
  } catch (e) { next(e); }
}

export async function register(req: Request, res: Response) {
  await limit(`reg:${req.ip}`, 5, 3600e3);
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const name = String(req.body.name ?? "").trim().slice(0, 60);
  const password = String(req.body.password ?? "");
  const base = CURRENCIES.includes(req.body.baseCurrency) ? req.body.baseCurrency : "JPY";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (!name) throw new HttpError(400, "Enter your name.");
  if (password.length < 10) throw new HttpError(400, "Use a password of at least 10 characters.");
  if (await get("SELECT 1 FROM users WHERE email = ?", email)) throw new HttpError(409, "An account with this email already exists.");
  const hash = await hashPassword(password);
  const id = await tx(async () => {
    const t = now();
    const uid = await insert("INSERT INTO users(email,name,pass_hash,base_currency,last_reviewed_at,created_at) VALUES (?,?,?,?,?,?)", email, name, hash, base, t, t);
    // One statement each for categories and cards: sign-up is a few round trips, not twenty.
    await run(`INSERT INTO categories(user_id,key,name,icon,slot,kind) VALUES ${DEFAULT_CATEGORIES.map(() => "(?,?,?,?,?,?)").join(",")}`,
      ...DEFAULT_CATEGORIES.flatMap((c) => [uid, c.key, c.name, c.icon, c.slot, c.kind]));
    await run(`INSERT INTO accounts(user_id,kind,bank,name,card_type,last4,currency,theme,created_at) VALUES ${STARTER_CARDS.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`,
      ...STARTER_CARDS.flatMap((c) => [uid, "card", c.bank, `${c.bank} ${c.card_type}`, c.card_type, c.last4, c.currency, c.theme, t]));
    return uid;
  });
  await startSession(res, id);
  res.status(201).json({ user: publicUser((await get<User>("SELECT * FROM users WHERE id = ?", id))!) });
}

export async function login(req: Request, res: Response) {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  await limit(`login:${req.ip}:${email}`, 10, 900e3);
  const u = await get<User>("SELECT * FROM users WHERE email = ?", email);
  // Verify against a dummy hash when the user is unknown so timing does not reveal it.
  const ok = await verifyPassword(String(req.body.password ?? ""), u?.pass_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!u || !ok) throw new HttpError(401, "Email or password is incorrect.");
  await startSession(res, u.id);
  // Housekeeping: expired sessions are cleared on sign-in rather than by a timer.
  await run("DELETE FROM sessions WHERE expires_at < ?", now());
  res.json({ user: publicUser(u) });
}

export async function logout(req: Request, res: Response) {
  const token = cookieOf(req);
  if (token) await run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}

export async function changePassword(req: Request, res: Response) {
  await limit(`pw:${req.user.id}`, 5, 900e3);
  if (!(await verifyPassword(String(req.body.current ?? ""), req.user.pass_hash))) throw new HttpError(400, "Current password is incorrect.");
  const next = String(req.body.next ?? "");
  if (next.length < 10) throw new HttpError(400, "Use a password of at least 10 characters.");
  await run("UPDATE users SET pass_hash = ? WHERE id = ?", await hashPassword(next), req.user.id);
  // Sign out every other device.
  await run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", req.user.id, sha256(cookieOf(req) ?? ""));
  res.json({ ok: true });
}

export async function userByIngestToken(header: string | undefined): Promise<User | undefined> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return undefined;
  return await get<User>("SELECT * FROM users WHERE ingest_token_hash = ?", sha256(token));
}

export { all };
