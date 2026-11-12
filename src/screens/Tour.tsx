/**
 * First-run welcome and guided tour.
 *  1. Welcome — "Welcome to Folio" over the live, blurred dashboard; after 5 s, Start Setup.
 *  2. Tour — a spotlight glides between the main components, dims everything else and outlines the
 *     current one with a soft breathing glow; a panel explains it, with Back / Next / Skip tour.
 *  3. Done — a personalised "You're all set" screen.
 * Progress is saved to the account (tour_step), so a reload resumes where the user left off.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useSpring, type MotionValue } from "motion/react";
import { api } from "../api.ts";
import { useApp, type Tab } from "../ctx.ts";
import { TextEffect } from "@/components/ui/text-effect";
import { LogoLoader } from "../ui/Logo.tsx";
import { Reveal } from "../ui/Reveal.tsx";
import { reducedMotion } from "../ui/spring.ts";

interface Step { id: string; tab: Tab; planView?: "budget" | "income"; title: string; body: string }
const STEPS: Step[] = [
  { id: "cards", tab: "home", title: "Your cards", body: "Your ICICI and Axis cards live here. Their balances update by themselves whenever a bank message states one. Tap the card behind to bring it forward, or tap a card to edit it." },
  { id: "transactions", tab: "home", title: "Every transaction, understood", body: "Paste or share your bank SMS and Folio reads the merchant, amount, card and category. Tap any transaction for its details, to change its category, or to delete it with Undo." },
  { id: "budget", tab: "home", title: "Your month at a glance", body: "What you've spent this month, what's left of your budget, and the last seven days. Tap it to set a budget and see where your money goes." },
  { id: "income", tab: "plan", planView: "income", title: "Income and scholarships", body: "Record scholarships, allowances and family transfers with the dates you expect them. Only money you mark as received is counted, never what's still expected." },
  { id: "invest", tab: "invest", title: "Your investments", body: "Add the shares you own and Folio values them with market prices: daily moves, total returns, the biggest movers, news and upcoming earnings." },
];
const WELCOME_MS = 5000;
/** The spotlight glides between targets on a spring (no overshoot to speak of), and keeps its velocity
 *  when the target changes mid-flight — e.g. while the page scrolls the next section into view. */
const GLIDE = { visualDuration: 0.55, bounce: 0.12 };
/** Moves a group of springs to new values: the first placement (or Reduce Motion) jumps, later ones glide. */
function drive(pairs: [MotionValue<number>, number][], jump: boolean) {
  for (const [mv, v] of pairs) jump ? mv.jump(v) : mv.set(v);
}
const PAD = 8;

type Rect = { top: number; left: number; width: number; height: number; radius: number };

export function Tour({ mode, start, onClose }: { mode: "first" | "replay"; start: number; onClose: () => void }) {
  const { user, setUser, go, tab, openImport } = useApp();
  const first = user.name.split(" ")[0];
  const [phase, setPhase] = useState<"welcome" | "tour" | "done">(start === 0 ? "welcome" : "tour");
  const [step, setStep] = useState(Math.min(Math.max(start - 1, 0), STEPS.length - 1));
  const [ready, setReady] = useState(false); // welcome: Start Setup shown after 5 s
  const [rect, setRect] = useState<Rect | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const target = useRef<Element | null>(null);
  // Spotlight geometry and panel position as springs (transform for position; GPU-composited).
  const sx = useSpring(0, GLIDE), sy = useSpring(0, GLIDE), sw = useSpring(0, GLIDE), sh = useSpring(0, GLIDE), sr = useSpring(20, GLIDE);
  const px = useSpring(0, GLIDE), py = useSpring(0, GLIDE);
  const spotPlaced = useRef(false), panelPlaced = useRef(false);
  useEffect(() => {
    if (!rect) { drive([[sx, innerWidth / 2], [sy, innerHeight / 2], [sw, 0], [sh, 0]], !spotPlaced.current || reducedMotion()); return; }
    drive([[sx, rect.left], [sy, rect.top], [sw, rect.width], [sh, rect.height], [sr, rect.radius]], !spotPlaced.current || reducedMotion());
    spotPlaced.current = true;
  }, [rect]);
  useEffect(() => {
    if (!panelPos) return;
    drive([[px, panelPos.left], [py, panelPos.top]], !panelPlaced.current || reducedMotion());
    panelPlaced.current = true;
  }, [panelPos]);

  const save = useCallback((body: object) => {
    if (mode !== "first") return; // replaying never changes saved progress
    api("/me", { method: "PATCH", body }).then((r) => { if ((body as any).onboarded) setUser(r.user); }).catch(() => {});
  }, [mode, setUser]);

  // ---- welcome: hold for five seconds, then offer Start Setup
  useEffect(() => {
    if (phase !== "welcome") return;
    const t = setTimeout(() => setReady(true), WELCOME_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // ---- measure the current target and keep the spotlight on it while scrolling / resizing
  // While the page scrolls a section into view, the spotlight is already gliding to where that section
  // will end up; following it mid-scroll would make the light swing past and come back.
  const scrollTarget = useRef<number | null>(null);
  const measure = useCallback(() => {
    const el = target.current;
    if (!el) return;
    const r0 = el.getBoundingClientRect();
    const shift = scrollTarget.current === null ? 0 : scrollTarget.current - scrollY;
    const r = { top: r0.top - shift, left: r0.left, width: r0.width, height: r0.height };
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20;
    // Very tall sections: spotlight their top part so the explanation still fits beside it.
    const height = Math.min(r.height, innerHeight * 0.5);
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: height + PAD * 2, radius: radius + PAD });
  }, []);

  useLayoutEffect(() => {
    if (phase !== "tour") return;
    const s = STEPS[step];
    let cancelled = false, raf = 0;
    target.current = null;
    if (s.planView) try { sessionStorage.setItem("folio-plan", s.planView); } catch { /* storage off */ }
    if (tab !== s.tab) go(s.tab);
    // Screens load their data first; wait for the component to exist (up to 4 s).
    const t0 = performance.now();
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${s.id}"]`);
      if (!el && performance.now() - t0 < 4000) { raf = requestAnimationFrame(find); return; }
      target.current = el;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      const fits = r.top >= 72 && r.top + Math.min(r.height, innerHeight * 0.5) <= innerHeight - 260;
      if (!fits) {
        const max = document.documentElement.scrollHeight - innerHeight;
        const y = Math.round(Math.min(max, Math.max(0, scrollY + r.top - Math.max(72, (innerHeight - Math.min(r.height, innerHeight * 0.5) - 260) / 2))));
        if (Math.abs(y - scrollY) > 1) {
          scrollTarget.current = y;
          const settle = () => { scrollTarget.current = null; removeEventListener("scrollend", settle); clearTimeout(t); measure(); };
          const t = setTimeout(settle, 900); // browsers without scrollend
          addEventListener("scrollend", settle);
          scrollTo({ top: y, behavior: reducedMotion() ? "auto" : "smooth" });
        }
      }
      measure();
    };
    raf = requestAnimationFrame(find);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, step]);

  useEffect(() => {
    if (phase !== "tour") return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    const ro = new ResizeObserver(on);
    if (target.current) ro.observe(target.current);
    const poll = setInterval(on, 400); // content inside the target may still be loading
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); ro.disconnect(); clearInterval(poll); cancelAnimationFrame(raf); };
  }, [phase, step, measure, rect === null]);

  // ---- place the explanation below the spotlight, or above it, whichever has room
  useLayoutEffect(() => {
    if (phase !== "tour") return;
    const ph = panel.current?.offsetHeight ?? 240, pw = Math.min(420, innerWidth - 32);
    if (!rect) { setPanelPos({ top: (innerHeight - ph) / 2, left: (innerWidth - pw) / 2 }); return; }
    const below = rect.top + rect.height + 16, above = rect.top - 16 - ph;
    const top = below + ph <= innerHeight - 16 ? below : above >= 16 ? above : innerHeight - ph - 16;
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - pw / 2), innerWidth - pw - 16);
    setPanelPos({ top, left });
  }, [rect, phase, step]);

  useEffect(() => { if (phase === "tour") panel.current?.focus({ preventScroll: true }); }, [phase, step]);

  // ---- navigation
  const startTour = () => { setPhase("tour"); setStep(0); save({ tourStep: 1 }); };
  const next = () => {
    if (step < STEPS.length - 1) { setStep(step + 1); save({ tourStep: step + 2 }); }
    else { setPhase("done"); save({ onboarded: true, tourStep: 0 }); go("home"); }
  };
  const back = () => { if (step > 0) { setStep(step - 1); save({ tourStep: step }); } };
  const skip = () => { save({ onboarded: true, tourStep: 0 }); go("home"); onClose(); };
  const finish = (importNow?: boolean) => { onClose(); if (importNow) setTimeout(() => openImport(), 300); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "tour") {
        if (e.key === "ArrowRight") next();
        else if (e.key === "ArrowLeft") back();
        else if (e.key === "Escape") skip();
      } else if (phase === "welcome" && ready && e.key === "Enter") startTour();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // ---- render
  if (phase === "welcome") {
    return (
      <div className="tour-veil" role="dialog" aria-modal="true" aria-label="Welcome to Folio">
        <div className="tour-welcome">
          <LogoLoader size={96} />
          <h1 className="tour-hero">
            <Reveal text="Welcome to " delay={0.3} />
            <Reveal text="Folio" className="grad-words" delay={0.75} />
          </h1>
          <TextEffect per="word" preset="fade" delay={1.6} className="tour-sub">{`Hi ${first}. Here's a quick look around.`}</TextEffect>
          <div className={`tour-start ${ready ? "in" : ""}`} aria-hidden={!ready}>
            <button className="btn tour-cta" onClick={startTour} disabled={!ready} tabIndex={ready ? 0 : -1}>Start Setup</button>
            <button className="btn plain small tour-later" onClick={skip} disabled={!ready} tabIndex={ready ? 0 : -1}>Not now</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="tour-veil" role="dialog" aria-modal="true" aria-label="Setup complete">
        <div className="tour-welcome">
          <svg className="tour-check" viewBox="0 0 64 64" aria-hidden="true">
            <defs><linearGradient id="tour-g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#19c37d" /><stop offset="0.5" stopColor="#20b7c9" /><stop offset="1" stopColor="#6c7bff" /></linearGradient></defs>
            <circle cx="32" cy="32" r="28" />
            <path d="M20 33l8 8 16-17" />
          </svg>
          <h1 className="tour-hero small"><Reveal text="You're all set, " delay={0.35} /><Reveal text={`${first}!`} className="grad-words" delay={0.6} /></h1>
          <TextEffect per="word" preset="fade" delay={1} className="tour-sub">Start by bringing in your bank messages. Folio does the rest.</TextEffect>
          <div className="tour-start in" style={{ animationDelay: "1.4s" }}>
            <button className="btn tour-cta" onClick={() => finish(true)}>Import bank messages</button>
            <button className="btn plain small tour-later" onClick={() => finish()}>Start using Folio</button>
          </div>
        </div>
      </div>
    );
  }

  const s = STEPS[step];
  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label={`Tour: ${s.title}`}>
      {/* Blocks the app underneath; the spotlight's shadow does the dimming. */}
      <div className="tour-catch" />
      <motion.div className={`tour-spot ${rect ? "" : "none"}`} style={{ x: sx, y: sy, width: sw, height: sh, borderRadius: sr }} aria-hidden="true" />
      <motion.div className="tour-panel" ref={panel} tabIndex={-1} style={{ x: px, y: py, opacity: panelPos ? 1 : 0 }}>
        <div className="between">
          <span className="eyebrow">Step {step + 1} of {STEPS.length}</span>
          <button className="btn plain small" style={{ minHeight: 28 }} onClick={skip}>Skip tour</button>
        </div>
        <div className="tour-copy" key={s.id} aria-live="polite">
          <Reveal as="h1" className="tour-title" text={s.title} />
          <TextEffect per="word" as="p" className="tour-body" delay={0.12} variants={{
            container: { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.012 } } },
            item: { hidden: { opacity: 0, y: 3, filter: "blur(3px)" }, visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.28 } } },
          }}>{s.body}</TextEffect>
        </div>
        <div className="tour-foot">
          <div className="ob-dots" aria-hidden="true">{STEPS.map((x, i) => <i key={x.id} className={i === step ? "on" : i < step ? "done" : ""} />)}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn gray small" onClick={back} disabled={step === 0}>Back</button>
            <button className="btn primary small" onClick={next} autoFocus>{step === STEPS.length - 1 ? "Finish" : "Next"}</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
