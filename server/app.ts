import express, { type Request, type Response, type NextFunction } from "express";
import { ready } from "./db.js";
import { changePassword, csrf, HttpError, login, logout, register, requireUser, userByIngestToken } from "./auth.js";
import { core, h, ingestBody } from "./routes/core.js";
import { income } from "./routes/income.js";
import { portfolio } from "./routes/portfolio.js";
import { answer, SUGGESTIONS } from "./services/assistant.js";
import { importMessages } from "./services/ingest.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
// Connect and create the schema before the first API request is handled.
app.use("/api", (_req, _res, next) => { ready().then(() => next(), next); });
app.use("/api", express.json({ limit: "5mb" }), (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); }, csrf);

app.post("/api/auth/register", h(register));
app.post("/api/auth/login", h(login));
app.post("/api/auth/logout", h(logout));

/**
 * Personal ingest endpoint for automations that can see incoming SMS on the user's own device
 * (iOS Shortcuts "When I get a message", Android SMS forwarders). Authenticated by a bearer token.
 */
app.post("/api/ingest/sms", h(async (req, res) => {
  const user = await userByIngestToken(req.get("authorization"));
  if (!user) throw new HttpError(401, "Invalid ingest token.");
  const r = await importMessages(user.id, ingestBody(req.body), "ingest");
  res.json({ imported: r.imported, duplicates: r.duplicates, ignored: r.ignored, balances: r.balances });
}));

app.use("/api", requireUser);
app.post("/api/me/password", h(changePassword));
app.use("/api", core, income, portfolio);
app.get("/api/assistant/suggestions", (_req, res) => res.json({ suggestions: SUGGESTIONS }));
app.post("/api/assistant", h(async (req, res) => {
  const question = String(req.body.question ?? "").trim().slice(0, 500);
  if (!question) throw new HttpError(400, "Ask a question.");
  const history = Array.isArray(req.body.history) ? req.body.history.filter((m: any) => ["user", "assistant"].includes(m?.role) && typeof m.text === "string").map((m: any) => ({ role: m.role, text: m.text.slice(0, 2000) })) : [];
  res.json({ answer: await answer(req.user, question, history, req.body.ai === true) });
}));
app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found.")));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "That file is too large." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
