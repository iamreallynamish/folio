import { useState } from "react";
import { api, type User } from "../api.ts";
import { CURRENCIES } from "../../shared/money.ts";
import { AppIcon } from "../ui/Logo.tsx";
import { Field, Segmented } from "../ui/kit.tsx";

export function Auth({ onDone }: { onDone: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ name: "", email: "", password: "", baseCurrency: "JPY" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { onDone((await api(`/auth/${mode}`, { body: f })).user); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <AppIcon />
          <h1 className="large-title" style={{ fontSize: 44, lineHeight: "48px" }}>Your money, <span className="grad">understood.</span></h1>
          <p className="muted subhead">Spending, budgets, income and investments,<br />built from your own records.</p>
        </div>
        <Segmented label="Sign in or create account" value={mode} onChange={(m) => { setMode(m); setError(""); }} options={[{ value: "login", label: "Sign in" }, { value: "register", label: "Create account" }]} />
        {mode === "register" && <Field label="Name"><input className="input" value={f.name} onChange={set("name")} autoComplete="name" required /></Field>}
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></Field>
        <Field label={mode === "register" ? "Password (10 characters or more)" : "Password"}>
          <input className="input" type="password" value={f.password} onChange={set("password")} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 10 : undefined} required />
        </Field>
        {mode === "register" && (
          <Field label="Main currency for budgets">
            <select className="input" value={f.baseCurrency} onChange={set("baseCurrency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <p className="caption faint" style={{ textAlign: "center" }}>Your records are stored on this Folio server under your account only.</p>
      </form>
    </div>
  );
}
