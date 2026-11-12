import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, type Account, type Category, type Txn, type User } from "./api.ts";
import { Ctx, type Tab } from "./ctx.ts";
import { Icon } from "./ui/Icon.tsx";
import { LogoLoader, LogoMark } from "./ui/Logo.tsx";
import { reducedMotion } from "./ui/spring.ts";
import { Tour } from "./screens/Tour.tsx";
import { ConfirmHost, setCacheOwner, ToastHost, useBackground } from "./ui/kit.tsx";
import { AsciiBackground } from "@/components/AsciiBackground";
import { Auth } from "./screens/Auth.tsx";
import { Home } from "./screens/Home.tsx";
import { Activity } from "./screens/Activity.tsx";
import { Plan } from "./screens/Plan.tsx";
import { Invest } from "./screens/Invest.tsx";
import { Assistant } from "./screens/Assistant.tsx";
import { Settings } from "./screens/Settings.tsx";
import { AccountSheet, ImportSheet, TxnSheet } from "./screens/sheets.tsx";
import { MotionConfig } from "motion/react";
import { useScreenEntrance } from "./ui/motion.tsx";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" }, { id: "activity", label: "Activity", icon: "list" }, { id: "plan", label: "Plan", icon: "pie" },
  { id: "invest", label: "Invest", icon: "trend" }, { id: "ask", label: "Ask", icon: "spark" },
];
const ORDER: Tab[] = ["home", "activity", "plan", "invest", "ask", "settings"];
const tabFromHash = (): Tab => (["home", "activity", "plan", "invest", "ask", "settings"].includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : "home");

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [version, setVersion] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txn, setTxn] = useState<Txn | "new" | null>(null);
  const [importing, setImporting] = useState<{ text?: string } | null>(null);
  const [account, setAccount] = useState<Account | "new" | null>(null);
  const [tour, setTour] = useState<{ mode: "first" | "replay"; start: number } | null>(null);
  // The welcome and tour start by themselves only until the account has finished or skipped them.
  useEffect(() => { if (user && !user.onboarded) setTour((t) => t ?? { mode: "first", start: user.tourStep }); }, [user?.id]);

  useEffect(() => {
    api("/me").then((r) => setUser(r.user)).catch(() => setUser(null));
    const out = () => setUser(null), hash = () => goRef.current(tabFromHash());
    window.addEventListener("folio:signed-out", out);
    window.addEventListener("hashchange", hash);
    return () => { window.removeEventListener("folio:signed-out", out); window.removeEventListener("hashchange", hash); };
  }, []);

  // Text shared into the installed app from the phone's share sheet opens the importer.
  useEffect(() => {
    if (!user) return;
    const shared = new URLSearchParams(location.search).get("share_text");
    if (shared) { setImporting({ text: shared }); history.replaceState(null, "", location.pathname + location.hash); }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api("/accounts").then((r) => setAccounts(r.accounts)).catch(() => {});
    api("/categories").then((r) => setCategories(r.categories)).catch(() => {});
  }, [user?.id, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  /**
   * Page changes slide in the direction of travel (left/right along the tab order) and cross-fade,
   * using View Transitions so the old page animates out while the new one arrives.
   * Tapping the current tab scrolls to the top, as on iOS.
   */
  setCacheOwner(user?.id ?? null);
  const ambient = useBackground();
  const mainRef = useRef<HTMLElement>(null);
  // Until the first screen is ready, the launch loader stays up: logo, then the finished page — no empty page between.
  const [booted, setBooted] = useState(false);
  useScreenEntrance(mainRef, `${tab}:${user?.id ?? ""}`, () => setBooted(true));
  const veil = !booted && <div key="veil" className="auth boot-veil" aria-busy="true"><LogoLoader size={72} /></div>;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const go = useCallback((t: Tab) => {
    if (location.hash.slice(1) !== t) history.pushState(null, "", `#${t}`);
    if (t === tabRef.current) { window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" }); return; }
    const forward = ORDER.indexOf(t) > ORDER.indexOf(tabRef.current);
    const swap = () => { flushSync(() => setTab(t)); window.scrollTo(0, 0); };
    const vt = (document as any).startViewTransition;
    if (!vt || reducedMotion()) return swap();
    const root = document.documentElement;
    root.dataset.nav = forward ? "forward" : "back";
    vt.call(document, swap).finished.finally(() => { delete root.dataset.nav; });
  }, []);
  const goRef = useRef(go);
  goRef.current = go;
  const ctx = useMemo(() => ({
    user: user!, setUser, version, refresh, accounts, categories, go, tab,
    startTour: () => { go("home"); setTimeout(() => setTour({ mode: "replay", start: 0 }), 350); },
    openTxn: setTxn, openImport: (text?: string) => setImporting({ text }), openAccount: setAccount,
  }), [user, version, refresh, accounts, categories, go, tab]);

  if (user === undefined) return <>{veil}{null}</>;
  if (!user) return <><Auth onDone={(u) => { setUser(u); go("home"); }} /><ToastHost /></>;

  const Screen = { home: Home, activity: Activity, plan: Plan, invest: Invest, ask: Assistant, settings: Settings }[tab];
  return (<>{veil}
    <Ctx.Provider value={ctx}>
      <MotionConfig reducedMotion="user">
      {ambient && <AsciiBackground />}
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <div className="brand"><LogoMark size={30} />Folio</div>
          {TABS.map((t) => <button key={t.id} className="side-link" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>{tab === t.id && <span className="side-pill" aria-hidden="true" />}<Icon name={t.icon} />{t.label === "Ask" ? "Assistant" : t.label}</button>)}
          <div style={{ flex: 1 }} />
          <button className="side-link" aria-current={tab === "settings" ? "page" : undefined} onClick={() => go("settings")}>{tab === "settings" && <span className="side-pill" aria-hidden="true" />}<Icon name="gear" />Settings</button>
        </nav>
        <main className="main" data-section={tab} ref={mainRef}><Screen key={tab} /></main>
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>{tab === t.id && <span className="tab-pill" aria-hidden="true" />}<Icon name={t.icon} />{t.label}</button>)}
        </nav>
        {/* Progressive blur where content meets the screen edges and the floating tab bar. */}
        <div className="edge-blur top" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="edge-blur bottom" aria-hidden="true"><i /><i /><i /><i /></div>
      </div>
      {txn && <TxnSheet txn={txn} onClose={() => setTxn(null)} />}
      {importing && <ImportSheet initialText={importing.text} onClose={() => setImporting(null)} />}
      {account && <AccountSheet account={account} onClose={() => setAccount(null)} />}
      {tour && <Tour mode={tour.mode} start={tour.start} onClose={() => setTour(null)} />}
      <ConfirmHost />
      <ToastHost />
      </MotionConfig>
    </Ctx.Provider>
  </>);
}
