export type CategoryKind = "expense" | "transfer";

export interface CategoryDef {
  key: string;
  name: string;
  icon: string;
  /** Chart colour slot 1–8; 0 = neutral grey. */
  slot: number;
  kind: CategoryKind;
}

/** Seeded for every new user. Users can rename, add and delete their own. */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { key: "food", name: "Food & Beverage", icon: "cup", slot: 2, kind: "expense" },
  { key: "groceries", name: "Groceries / Convenience Store", icon: "basket", slot: 3, kind: "expense" },
  { key: "transport", name: "Transportation", icon: "car", slot: 1, kind: "expense" },
  { key: "shopping", name: "Shopping", icon: "bag", slot: 5, kind: "expense" },
  { key: "entertainment", name: "Entertainment", icon: "play", slot: 7, kind: "expense" },
  { key: "subscriptions", name: "Subscriptions", icon: "repeat", slot: 4, kind: "expense" },
  { key: "bills", name: "Bills & Utilities", icon: "bolt", slot: 6, kind: "expense" },
  { key: "health", name: "Health", icon: "heart", slot: 8, kind: "expense" },
  { key: "education", name: "Education", icon: "book", slot: 0, kind: "expense" },
  { key: "travel", name: "Travel", icon: "plane", slot: 0, kind: "expense" },
  { key: "housing", name: "Housing", icon: "home", slot: 0, kind: "expense" },
  { key: "fees", name: "Fees & Charges", icon: "percent", slot: 0, kind: "expense" },
  { key: "other", name: "Other", icon: "dots", slot: 0, kind: "expense" },
  { key: "uncategorised", name: "Uncategorised", icon: "question", slot: 0, kind: "expense" },
  { key: "topup", name: "Stored-value top-up", icon: "wallet", slot: 0, kind: "transfer" },
  { key: "transfer", name: "Transfer", icon: "swap", slot: 0, kind: "transfer" },
  { key: "cash", name: "Cash withdrawal", icon: "wallet", slot: 0, kind: "transfer" },
];
