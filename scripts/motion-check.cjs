/**
 * Motion check: drives every animated interaction in Folio on an emulated iPhone with the CPU slowed 4×
 * (roughly a mid-range phone) and reports frame timing per scenario:
 *   frames · p50 / p95 / worst frame (ms) · % janky frames (> 25 ms, i.e. a dropped frame at 60 Hz) ·
 *   long animation frames (> 50 ms, browser-reported) · layout shift.
 * Usage: start the server (FOLIO_DB=:memory: PORT=8792 npx tsx server/index.ts), then  node scripts/motion-check.cjs [label]
 */
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE ?? "http://localhost:8792";
const label = process.argv[2] ?? "run";

const PROBE = () => {
  // Measuring continues across a reload (launch scenarios), via sessionStorage.
  const carried = JSON.parse(sessionStorage.getItem("__m") || "null");
  window.__frames = carried?.frames ?? []; window.__loaf = carried?.loaf ?? []; window.__cls = carried?.cls ?? 0; let last = 0, on = !!carried;
  if (carried) sessionStorage.removeItem("__m");
  addEventListener("pagehide", () => { if (on) sessionStorage.setItem("__m", JSON.stringify({ frames: window.__frames, loaf: window.__loaf, cls: window.__cls })); });
  window.__start = () => { window.__frames = []; window.__loaf = []; window.__cls = 0; last = 0; on = true; };
  window.__stop = () => { on = false; sessionStorage.removeItem("__m"); return { frames: window.__frames, loaf: window.__loaf, cls: window.__cls }; };
  const tick = (t) => { if (on && last) window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { if (on) for (const e of l.getEntries()) window.__loaf.push(e.duration); }).observe({ type: "long-animation-frame", buffered: false }); } catch {}
  try { new PerformanceObserver((l) => { if (on) for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: false }); } catch {}
};

function stats(name, r) {
  const f = r.frames.filter((x) => x > 0).sort((a, b) => a - b);
  const q = (p) => (f.length ? f[Math.min(f.length - 1, Math.floor(p * f.length))] : 0);
  return { scenario: name, frames: f.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), worst: +(f[f.length - 1] ?? 0).toFixed(1),
    jankPct: f.length ? +((100 * f.filter((x) => x > 25).length) / f.length).toFixed(1) : 0, longFrames: r.loaf.length, cls: +r.cls.toFixed(3) };
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  await ctx.addInitScript(PROBE);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const results = [];
  const measure = async (name, fn, settle = 900) => {
    await p.evaluate(() => window.__start());
    await fn();
    await p.waitForTimeout(settle);
    results.push(stats(name, await p.evaluate(() => window.__stop())));
  };

  // New account → setup
  await p.goto(BASE + "/"); await p.waitForTimeout(1500);
  const email = `motion${Date.now()}@example.com`;
  await p.request.post(BASE + "/api/auth/register", { headers: { "X-Folio": "1" }, data: { name: "Mira Sato", email, password: "correct horse battery" } });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await measure("launch: loader → setup", async () => { await p.reload(); await p.waitForSelector(".setup-cta", { timeout: 15000 }); }, 1200);
  const cont = () => p.locator(".setup-cta").tap();
  await measure("setup: hello → goals", cont);
  await measure("setup: tap tiles (reply hop)", async () => { await p.getByRole("button", { name: /Stick to a monthly budget/ }).tap(); await p.waitForTimeout(300); await p.getByRole("button", { name: /See where my money goes/ }).tap(); });
  await measure("setup: goals → currency", cont);
  await p.getByRole("button", { name: /Japanese yen/ }).tap();
  await measure("setup: currency → income", cont);
  await p.getByRole("button", { name: /Part-time job/ }).tap(); await cont(); await p.waitForTimeout(600);
  await p.locator(".setup-tile").first().tap();
  await measure("setup: budget → colour", cont);
  await measure("setup: pick colours (recolour app)", async () => { for (const n of ["Ocean", "Rose", "Mint"]) { await p.getByRole("button", { name: new RegExp(n) }).tap(); await p.waitForTimeout(250); } });
  await cont(); await p.waitForTimeout(600);
  await p.getByLabel("Bank or issuer").fill("HDFC Bank"); await p.getByLabel("Last four digits").fill("4321");
  await measure("setup: add a card", async () => { await p.getByRole("button", { name: /^Add card/ }).tap(); });
  await cont(); await p.waitForTimeout(600);
  await p.getByRole("button", { name: /Maybe later/ }).tap();
  await measure("setup: finish (confetti)", cont, 2200);

  // Tour
  await measure("tour: start (spotlight in)", async () => { await p.getByRole("button", { name: "Show me around" }).tap(); await p.waitForSelector(".tour-panel"); }, 1500);
  for (let i = 0; i < 6 && (await p.getByRole("button", { name: /^(Next|Finish)$/ }).count()); i++)
    await measure(`tour: step ${i + 1} → ${i + 2}`, async () => { await p.getByRole("button", { name: /^(Next|Finish)$/ }).tap(); }, 1300);
  if (await p.getByRole("button", { name: "Start using Folio" }).count()) await measure("tour: close", async () => { await p.getByRole("button", { name: "Start using Folio" }).tap(); }, 1200);

  // Data for the app screens
  const text = fs.readFileSync(path.join(__dirname, "../tests/fixtures-sample-messages.txt"), "utf8");
  await p.evaluate((text) => fetch("/api/sms/import", { method: "POST", headers: { "content-type": "application/json", "X-Folio": "1" }, body: JSON.stringify({ text }) }), text);
  await measure("launch: loader → home (cold)", async () => { await p.reload(); await p.waitForSelector(".month-panel", { timeout: 15000 }); }, 1500);

  const tab = (name) => p.locator(".tabbar .tab", { hasText: name }).tap();
  for (const [from, to] of [["Home", "Activity"], ["Activity", "Plan"], ["Plan", "Invest"], ["Invest", "Ask"], ["Ask", "Home"], ["Home", "Plan"], ["Plan", "Home"]])
    await measure(`page: ${from} → ${to}`, () => tab(to), 1100);

  await measure("scroll: home fling", async () => { await p.mouse.wheel(0, 900); await p.waitForTimeout(500); await p.mouse.wheel(0, -900); }, 900);
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400);
  await measure("cards: bring the back card forward", async () => { await p.locator("button.pay-card.peek").first().tap({ position: { x: 150, y: 16 }, force: true }); }, 1200);
  await measure("sheet: open transaction", async () => { await p.locator(".list .cell.txn").first().tap(); await p.waitForSelector(".sheet"); }, 900);
  await measure("sheet: close", async () => { await p.getByRole("button", { name: "Done" }).tap(); }, 900);
  await measure("sheet: open import", async () => { await p.locator(".quick-pills button", { hasText: "Import" }).tap(); await p.waitForSelector(".sheet"); }, 900);
  await measure("sheet: swipe down to close", async () => {
    const h = await p.locator(".sheet-grab, .sheet-head").first().boundingBox();
    await p.mouse.move(h.x + h.width / 2, h.y + 8); await p.mouse.down();
    for (let i = 1; i <= 12; i++) { await p.mouse.move(h.x + h.width / 2, h.y + 8 + i * 30); await p.waitForTimeout(12); }
    await p.mouse.up();
  }, 1000);
  await measure("theme: dark → light", async () => { await p.locator(".home-head button.icon-btn").first().tap(); }, 900);
  await measure("theme: light → dark", async () => { await p.locator(".home-head button.icon-btn").first().tap(); }, 900);
  await measure("idle: home with background animation (3 s)", async () => { await p.waitForTimeout(3000); }, 0);

  await b.close();
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${label}\n` + pad("scenario", 42) + pad("frames", 8) + pad("p50", 7) + pad("p95", 7) + pad("worst", 8) + pad("jank%", 7) + pad("long", 6) + "shift");
  for (const r of results) console.log(pad(r.scenario, 42) + pad(r.frames, 8) + pad(r.p50, 7) + pad(r.p95, 7) + pad(r.worst, 8) + pad(r.jankPct, 7) + pad(r.longFrames, 6) + r.cls);
  const out = path.join(process.env.OUT ?? ".", `motion-${label}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  if (errs.length) console.log("page errors:", errs);
})();
