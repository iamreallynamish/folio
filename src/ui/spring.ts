/**
 * Springs in Apple's terms (WWDC "Designing Fluid Interfaces"):
 *   damping  — 1.0 settles with no overshoot; below 1 bounces.
 *   response — roughly how quickly the value gets there, in seconds. Not a duration.
 * Every animation starts from the current on-screen value and carries velocity, so it can be
 * grabbed and redirected at any moment.
 */
export interface SpringOptions { damping?: number; response?: number; velocity?: number }
export interface SpringHandle { stop(): void; readonly value: number; readonly velocity: number }

export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Presets from the values Apple ships. */
export const SPRING = {
  /** Default UI motion: no overshoot. */
  smooth: { damping: 1, response: 0.38 },
  /** Sheets and drawers. */
  sheet: { damping: 1, response: 0.32 },
  /** After a flick: a little bounce, because the gesture carried momentum. */
  momentum: { damping: 0.82, response: 0.34 },
} as const;

export function spring(from: number, to: number, opts: SpringOptions, onUpdate: (v: number) => void, onDone?: () => void): SpringHandle {
  const damping = opts.damping ?? 1, response = opts.response ?? 0.38;
  const k = (2 * Math.PI / response) ** 2; // stiffness, mass = 1
  const c = (4 * Math.PI * damping) / response; // damping coefficient
  let x = from, v = opts.velocity ?? 0, raf = 0, last = 0, running = true;

  // Reduced motion: no travel, the caller cross-fades instead.
  if (reducedMotion()) {
    x = to; v = 0; running = false;
    onUpdate(to); onDone?.();
    return { stop() {}, get value() { return x; }, get velocity() { return 0; } };
  }

  const step = (t: number) => {
    if (!running) return;
    const dt = Math.min(0.064, last ? (t - last) / 1000 : 1 / 60);
    last = t;
    // Fixed sub-steps keep stiff springs stable on slow frames.
    for (let i = 0, n = Math.ceil(dt / (1 / 240)), h = dt / n; i < n; i++) {
      const a = -k * (x - to) - c * v;
      v += a * h;
      x += v * h;
    }
    if (Math.abs(x - to) < 0.3 && Math.abs(v) < 4) {
      x = to; v = 0; running = false;
      onUpdate(x); onDone?.();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    stop() { running = false; cancelAnimationFrame(raf); },
    get value() { return x; },
    get velocity() { return v; },
  };
}

/** Where a flick would come to rest — Apple's projection, as used for scroll deceleration. */
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary instead of a hard stop. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Pointer velocity from the last ~100 ms of samples, in px/s. */
export class VelocityTracker {
  private samples: { t: number; y: number }[] = [];
  add(y: number, t = performance.now()) {
    this.samples.push({ t, y });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }
  get() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0], b = s[s.length - 1];
    return b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
  }
  reset() { this.samples = []; }
}
