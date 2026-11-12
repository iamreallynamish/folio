import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { project, reducedMotion, rubberband, spring, SPRING, VelocityTracker, type SpringHandle } from "./spring.ts";
import { Icon } from "./Icon.tsx";

/** Load data, re-running when `deps` change. Keeps the previous data visible while refreshing. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    fn().then((d) => { if (n === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (n === seq.current) setError(e.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

/**
 * Bottom sheet driven by springs: it opens and closes from wherever it is on screen, follows the
 * finger 1:1 with a rubber band at the top, and decides dismissal from where a flick is heading.
 * On wide screens it is a centred dialog. Escape, the backdrop and Cancel all close it.
 */
export function Sheet({ title, onClose, children, action, cancelLabel = "Cancel", variant = "sheet", closeRef }: {
  title: string; onClose: () => void; children: ReactNode | ((close: () => void) => ReactNode); action?: ReactNode; cancelLabel?: string; variant?: "sheet" | "action";
  /** Filled with a function that closes the sheet with its exit animation. */
  closeRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const anim = useRef<SpringHandle | null>(null);
  const y = useRef(0); // sheet offset in px (0 = open); on desktop the open progress is derived from it
  const drag = useRef<{ start: number; tracker: VelocityTracker } | null>(null);
  const closing = useRef(false);
  const desktop = useMedia("(min-width: 700px)");
  const height = () => ref.current?.offsetHeight || 600;

  const paint = useCallback((v: number) => {
    y.current = v;
    const el = ref.current, h = height();
    if (!el) return;
    const p = Math.max(0, Math.min(1, 1 - v / h)); // 1 = fully open
    if (reducedMotion()) el.style.transform = "none";
    else if (desktop) el.style.transform = `translateY(${(1 - p) * 28}px) scale(${0.96 + 0.04 * p})`;
    else el.style.transform = `translate3d(0, ${v}px, 0)`;
    if (desktop || reducedMotion()) el.style.opacity = String(p);
    if (backdrop.current) {
      backdrop.current.style.opacity = String(p);
      // The scrim materialises with the sheet: blur grows with it instead of snapping on.
      backdrop.current.style.backdropFilter = `blur(${6 * p}px)`;
      backdrop.current.style.setProperty("-webkit-backdrop-filter", `blur(${6 * p}px)`);
    }
  }, [desktop]);

  const animateTo = useCallback((target: number, velocity = 0, done?: () => void) => {
    anim.current?.stop();
    const opts = target === 0 && Math.abs(velocity) > 400 ? SPRING.momentum : SPRING.sheet;
    anim.current = spring(y.current, target, { ...opts, velocity }, paint, done);
  }, [paint]);

  const close = useCallback((velocity = 0) => {
    closing.current = true;
    animateTo(height(), velocity, onClose);
  }, [animateTo, onClose]);
  if (closeRef) closeRef.current = () => close();

  useLayoutEffect(() => {
    paint(height()); // start off-screen, then spring in
    animateTo(0);
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    ref.current?.focus({ preventScroll: true });
    return () => { anim.current?.stop(); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grab anywhere on the header (or the grabber), even mid-animation: motion stops and follows the finger.
  const down = (e: React.PointerEvent) => {
    if (desktop || reducedMotion() || (e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    anim.current?.stop();
    closing.current = false;
    drag.current = { start: e.clientY - y.current, tracker: new VelocityTracker() };
    drag.current.tracker.add(y.current);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.start;
    const v = raw < 0 ? rubberband(raw, height()) : raw; // resist above the open position
    d.tracker.add(v);
    paint(v);
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const velocity = d.tracker.get();
    // A real flick decides by its direction; a slow drag by where its momentum would carry it.
    const dismiss = Math.abs(velocity) > 350 ? velocity > 0 : y.current + project(velocity) > height() * 0.5;
    if (dismiss) close(velocity);
    else animateTo(0, velocity);
  };

  // Rendered at the document root: an animated ancestor would otherwise trap a fixed overlay inside it.
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="scrim" ref={backdrop} aria-hidden="true" />
      <div className={`sheet ${variant === "action" ? "action" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={{ outline: "none" }}>
        {variant === "sheet" ? (
          <div className="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <button className="btn plain" onClick={() => close()}>{cancelLabel}</button>
            <span className="headline">{title}</span>
            <span style={{ minWidth: 64, textAlign: "right" }}>{action}</span>
          </div>
        ) : <div className="sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />}
        <div className="sheet-body">{typeof children === "function" ? children(() => close()) : children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- action sheet: in-app replacement for confirm() / prompt() ----------
export interface ConfirmOptions { title: string; message?: string; confirm: string; destructive?: boolean; requireText?: string }
let openConfirm: (o: ConfirmOptions) => Promise<boolean> = async () => false;
/** Ask before a destructive, non-undoable action. Resolves true only on an explicit confirm. */
export const confirmAction = (o: ConfirmOptions) => openConfirm(o);
export function ConfirmHost() {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState("");
  const answer = useRef(false);
  useEffect(() => { openConfirm = (o) => new Promise((resolve) => { answer.current = false; setTyped(""); setReq({ ...o, resolve }); }); }, []);
  if (!req) return null;
  const finish = () => { req.resolve(answer.current); setReq(null); };
  const ok = !req.requireText || typed.trim() === req.requireText;
  return (
    <Sheet title={req.title} onClose={finish} variant="action">
      {(close: () => void) => (
        <div className="action-sheet">
          <div className="action-text">
            <div className="headline">{req.title}</div>
            {req.message && <p className="footnote muted">{req.message}</p>}
            {req.requireText && <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${req.requireText} to confirm`} aria-label={`Type ${req.requireText} to confirm`} autoFocus autoCapitalize="characters" />}
          </div>
          <button className={`btn block ${req.destructive ? "destructive" : "primary"}`} disabled={!ok} onClick={() => { answer.current = true; close(); }}>{req.confirm}</button>
          <button className="btn block gray" onClick={() => close()} autoFocus={!req.requireText}>Cancel</button>
        </div>
      )}
    </Sheet>
  );
}

export const currentTheme = (): "light" | "dark" => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
export function setTheme(t: "system" | "light" | "dark") {
  const apply = () => applyTheme(t);
  // Ease the light/dark change rather than flashing it (motion guidance on brightness jumps).
  const vt = (document as any).startViewTransition;
  if (vt && !reducedMotion()) vt.call(document, apply); else apply();
}
function applyTheme(t: "system" | "light" | "dark") {
  if (t === "system") { localStorage.removeItem("folio-theme"); delete document.documentElement.dataset.theme; }
  else { localStorage.setItem("folio-theme", t); document.documentElement.dataset.theme = t; }
  // Announce only once the change has applied (it runs inside the cross-fade callback).
  window.dispatchEvent(new Event("folio:theme"));
}
export function ThemeToggle() {
  const [t, setT] = useState(currentTheme);
  useEffect(() => { const f = () => setT(currentTheme()); window.addEventListener("folio:theme", f); return () => window.removeEventListener("folio:theme", f); }, []);
  return <button className="icon-btn" aria-label={t === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(t === "dark" ? "light" : "dark")}><Icon name={t === "dark" ? "sun" : "moon"} /></button>;
}
export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q), f = () => setM(mq.matches); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, [q]);
  return m;
}

/** Circular progress with content in the middle. */
export function Ring({ pct, size = 128, tone = "", children }: { pct: number; size?: number; tone?: string; children?: ReactNode }) {
  const r = 44, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct));
  return (
    <div className={`ring ${tone}`} style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r={r} className="track" /><circle cx="50" cy="50" r={r} className="bar" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" /></svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} /><div className="headline" style={{ color: "var(--label)" }}>{title}</div>{children}</div>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warning" | "over"; children: ReactNode }) {
  return <div className={`notice ${kind === "info" ? "" : kind}`} role={kind === "info" ? undefined : "status"}><Icon name={kind === "info" ? "info" : "warn"} /><div>{children}</div></div>;
}

export function Provenance({ kind }: { kind: "verified" | "estimate" | "ai" | "none" }) {
  if (kind === "none") return null;
  const map = { verified: ["check", "Verified from your records"], estimate: ["info", "Estimate"], ai: ["spark", "AI-generated"] } as const;
  return <span className={`badge ${kind}`}><Icon name={map[kind][0]} />{map[kind][1]}</span>;
}

type ToastAction = { label: string; onClick: () => void };
let pushToast: (m: string, action?: ToastAction, ms?: number) => void = () => {};
/** A short status message. With an action (e.g. Undo) it stays a little longer. */
export const toast = (m: string, action?: ToastAction, ms?: number) => pushToast(m, action, ms);
export function ToastHost() {
  const [msg, setMsg] = useState<{ text: string; action?: ToastAction; key: number } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    pushToast = (text, action, ms) => { setMsg({ text, action, key: Date.now() }); clearTimeout(t); t = setTimeout(() => setMsg(null), ms ?? (action ? 5000 : 3000)); };
    return () => clearTimeout(t);
  }, []);
  if (!msg) return null;
  return (
    <div className="toast" role="status" key={msg.key}>
      <span>{msg.text}</span>
      {msg.action && <button className="toast-action" onClick={() => { msg.action!.onClick(); setMsg(null); }}>{msg.action.label}</button>}
    </div>
  );
}

/** For components that render a Sheet: `dismiss()` closes it with its exit animation. */
export function useSheetClose(onClose: () => void) {
  const ref = useRef<(() => void) | null>(null);
  return { ref, dismiss: () => (ref.current ?? onClose)() };
}

/** Rows hidden while an undoable delete is pending. */
const hidden = new Set<number>();
const hiddenSubs = new Set<() => void>();
export const hideRow = (id: number, on: boolean) => { if (on) hidden.add(id); else hidden.delete(id); hiddenSubs.forEach((f) => f()); };
export function useHidden(id: number) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); hiddenSubs.add(f); return () => { hiddenSubs.delete(f); }; }, []);
  return hidden.has(id);
}

export function Skeleton({ h = 120 }: { h?: number }) { return <div className="skeleton" style={{ height: h }} aria-hidden="true" />; }

export function MonthNav({ month, onChange, max }: { month: string; onChange: (m: string) => void; max: string }) {
  const shift = (by: number) => { const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const label = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="icon-btn" aria-label="Previous month" onClick={() => onChange(shift(-1))}><Icon name="back" /></button>
      <span className="headline num" style={{ minWidth: 132, textAlign: "center" }} aria-live="polite">{label}</span>
      <button className="icon-btn" aria-label="Next month" disabled={month >= max} style={{ opacity: month >= max ? 0.35 : 1 }} onClick={() => onChange(shift(1))}><Icon name="chevron" /></button>
    </div>
  );
}
