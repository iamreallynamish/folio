/**
 * Motion for the whole app (motion/react, per the Motion skill's React rules):
 *  - enterScreen: a page's sections cascade in when it opens, then the visible list rows.
 *  - CountUp: key amounts rise in character by character on first open, then count between values.
 * Transform + opacity only (GPU-accelerated); no overshoot — this is a finance app.
 * Under Reduce Motion, content fades without moving, and numbers appear at their final value.
 */
import { animate, stagger } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextReveal } from "@/components/ui/text-reveal-animation";
import { reducedMotion } from "./spring.ts";

const EASE = [0.16, 1, 0.3, 1] as const;
/** Layout wrappers we look inside rather than animate as one block. */
const WRAPPERS = ".home-grid, .home-col, .grid-2, .tiles, div.stack:not(.card)";
/** Headers animate their own text (Reveal). */
const SKIP = ".screen-head, .home-head, .sr";

function leaves(el: Element, out: HTMLElement[]) {
  for (const c of Array.from(el.children) as HTMLElement[]) {
    if (c.matches(SKIP) || c.tagName === "SCRIPT" || c.tagName === "STYLE") continue;
    if (c.matches(WRAPPERS)) leaves(c, out);
    else out.push(c);
  }
}

/** Cascade a freshly opened screen in. Only what's on screen moves; the rest is simply there. */
export function enterScreen(screen: HTMLElement) {
  const blocks: HTMLElement[] = [];
  leaves(screen, blocks);
  const visible = blocks.filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  if (!visible.length) return;
  const reduce = reducedMotion();
  // Rows inside visible lists follow their list in, a beat later.
  const rows: HTMLElement[] = [];
  for (const b of visible) {
    const lists = b.matches(".list") ? [b] : (Array.from(b.querySelectorAll(":scope .list")) as HTMLElement[]);
    for (const l of lists) for (const r of Array.from(l.children).slice(0, 8) as HTMLElement[]) {
      const rr = r.getBoundingClientRect();
      if (rr.top < innerHeight) rows.push(r);
    }
  }
  const all = [...visible, ...rows];
  for (const el of all) el.style.opacity = "0"; // before the first paint, so nothing flashes
  // Motion commits its final values as the animation finishes; clear them on the next frame so the
  // elements return to their stylesheet transforms (e.g. press-down scale) and nothing lingers inline.
  const cleanup = (els: HTMLElement[]) => () => requestAnimationFrame(() => { for (const el of els) { el.style.opacity = ""; el.style.transform = ""; } });
  animate(visible, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], y: [14, 0] },
    { duration: reduce ? 0.2 : 0.5, ease: EASE, delay: stagger(0.045, { startDelay: 0.04 }) }).finished.then(cleanup(visible));
  if (rows.length) {
    animate(rows, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], y: [8, 0] },
      { duration: reduce ? 0.2 : 0.4, ease: EASE, delay: stagger(0.03, { startDelay: 0.14 }) }).finished.then(cleanup(rows));
  }
}

/**
 * Watches <main>; when a new screen has finished loading (no skeletons left), cascades it in once.
 */
const entered = new Set<string>();
export function useScreenEntrance(main: React.RefObject<HTMLElement | null>, key: string) {
  // Layout effect: runs before the new screen's first paint, so its placeholders never flash.
  useLayoutEffect(() => {
    const root = main.current;
    // Once per screen per visit: returning to a screen just slides it in, with no second cascade.
    if (!root || entered.has(key)) { if (root) { delete root.dataset.entering; delete root.dataset.entered; } return; }
    entered.add(key);
    delete root.dataset.entered;
    root.dataset.entering = "";
    let done = false;
    const reveal = () => { delete root.dataset.entering; };
    const tryEnter = () => {
      if (done) return;
      const screen = root.querySelector<HTMLElement>(":scope > .screen");
      if (!screen || screen.querySelector(".skeleton") || screen.children.length < 2) return;
      done = true;
      obs.disconnect();
      enterScreen(screen); // hides the blocks first…
      root.dataset.entered = "";
      reveal(); // …then shows the screen, in the same frame
    };
    // MutationObserver callbacks run before the next paint, so content never flashes before animating.
    const obs = new MutationObserver(tryEnter);
    obs.observe(root, { childList: true, subtree: true });
    tryEnter();
    // A slow connection: show the loading placeholders after a moment rather than an empty page.
    const slow = setTimeout(reveal, 900);
    const t = setTimeout(() => { done = true; obs.disconnect(); }, 3000);
    return () => { obs.disconnect(); clearTimeout(t); clearTimeout(slow); reveal(); };
  }, [key]);
}

/** Last shown value per number, so a remount doesn't count up from zero again. */
const shown = new Map<string, number>();
/**
 * A key amount. The first time it appears in a visit its characters rise into place (TextReveal);
 * after that, when the value changes, it counts from the old value to the new one.
 */
export function CountUp({ value, format, className, id }: { value: number; format: (v: number) => string; className?: string; id: string }) {
  const [first] = useState(() => !shown.has(id));
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(shown.get(id) ?? value);
  useEffect(() => {
    const el = ref.current;
    if (!el) { prev.current = value; shown.set(id, value); return; }
    if (reducedMotion() || prev.current === value) { el.textContent = format(value); prev.current = value; shown.set(id, value); return; }
    const controls = animate(prev.current, value, {
      duration: 0.9, ease: EASE,
      onUpdate: (v) => { el.textContent = format(v); },
    });
    prev.current = value;
    shown.set(id, value);
    return () => controls.stop();
  }, [value]);
  // The final value is in the DOM from the start (for screen readers and if JS animation is skipped).
  if (first && prev.current === value) return <TextReveal as="span" word={format(value)} className={className} delay={0.12} step={0.03} />;
  return <span ref={ref} className={className}>{format(value)}</span>;
}
