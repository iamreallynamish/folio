import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Account, type Category, type Txn, type User } from "./api.ts";
import { Ctx, type Tab } from "./ctx.ts";
import { Icon } from "./ui/Icon.tsx";
import { LogoMark } from "./ui/Logo.tsx";
import { ToastHost } from "./ui/kit.tsx";
import { Auth } from "./screens/Auth.tsx";
import { Home } from "./screens/Home.tsx";
import { Activity } from "./screens/Activity.tsx";
import { Plan } from "./screens/Plan.tsx";
import { Invest } from "./screens/Invest.tsx";
import { Assistant } from "./screens/Assistant.tsx";
import { Settings } from "./screens/Settings.tsx";
import { AccountSheet, ImportSheet, TxnSheet } from "./screens/sheets.tsx";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" }, { id: "activity", label: "Activity", icon: "list" }, { id: "plan", label: "Plan", icon: "pie" },
  { id: "invest", label: "Invest", icon: "trend" }, { id: "ask", label: "Ask", icon: "spark" },
];
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

  useEffect(() => {
    api("/me").then((r) => setUser(r.user)).catch(() => setUser(null));
    const out = () => setUser(null), hash = () => setTab(tabFromHash());
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
  const go = useCallback((t: Tab) => { location.hash = t; setTab(t); window.scrollTo({ top: 0 }); }, []);
  const ctx = useMemo(() => ({
    user: user!, setUser, version, refresh, accounts, categories, go,
    openTxn: setTxn, openImport: (text?: string) => setImporting({ text }), openAccount: setAccount,
  }), [user, version, refresh, accounts, categories, go]);

  if (user === undefined) return <div className="auth"><LogoMark size={56} /></div>;
  if (!user) return <><Auth onDone={(u) => { setUser(u); go("home"); }} /><ToastHost /></>;

  const Screen = { home: Home, activity: Activity, plan: Plan, invest: Invest, ask: Assistant, settings: Settings }[tab];
  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <div className="brand"><LogoMark size={30} />Folio</div>
          {TABS.map((t) => <button key={t.id} className="side-link" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}><Icon name={t.icon} />{t.label === "Ask" ? "Assistant" : t.label}</button>)}
          <div style={{ flex: 1 }} />
          <button className="side-link" aria-current={tab === "settings" ? "page" : undefined} onClick={() => go("settings")}><Icon name="gear" />Settings</button>
        </nav>
        <main className="main" data-section={tab}><Screen key={tab} /></main>
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}><Icon name={t.icon} />{t.label}</button>)}
        </nav>
      </div>
      {txn && <TxnSheet txn={txn} onClose={() => setTxn(null)} />}
      {importing && <ImportSheet initialText={importing.text} onClose={() => setImporting(null)} />}
      {account && <AccountSheet account={account} onClose={() => setAccount(null)} />}
      <ToastHost />
    </Ctx.Provider>
  );
}
