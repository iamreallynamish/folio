import { createContext, useContext } from "react";
import type { Account, Category, Txn, User } from "./api.ts";

export type Tab = "home" | "activity" | "plan" | "invest" | "ask" | "settings";
export interface AppCtx {
  user: User; setUser: (u: User | null) => void;
  /** Bumped after any change so screens reload their data. */
  version: number; refresh: () => void;
  accounts: Account[]; categories: Category[];
  go: (tab: Tab) => void;
  /** The current tab (the tour navigates between them). */
  tab: Tab;
  /** Replay the guided tour (Settings). */
  startTour: () => void;
  openTxn: (t: Txn | "new") => void;
  openImport: (text?: string) => void;
  openAccount: (a: Account | "new") => void;
}
export const Ctx = createContext<AppCtx>(null as any);
export const useApp = () => useContext(Ctx);
