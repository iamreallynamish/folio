/** Thin fetch wrapper. All state-changing requests carry the X-Folio header the server requires. */
export class ApiError extends Error { constructor(message: string, public status: number, public data: any) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", "X-Folio": "1" },
    credentials: "same-origin",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth")) window.dispatchEvent(new Event("folio:signed-out"));
    throw new ApiError(data.error ?? "Something went wrong.", res.status, data);
  }
  return data as T;
}

export interface User { id: number; email: string; name: string; baseCurrency: string; monthlyBudgetMinor: number | null; alertThreshold: number; lastReviewedAt: string; hasMarketKey: boolean; hasAssistantKey: boolean; hasIngestToken: boolean }
export interface Account { id: number; kind: string; bank: string | null; name: string; cardType: string | null; last4: string | null; currency: string; balanceMinor: number | null; balanceAsOf: string | null; balanceSource: string | null; theme: string }
export interface Category { id: number; key: string | null; name: string; icon: string; slot: number; kind: string; budgetMinor: number | null }
export interface Txn {
  id: number; type: "expense" | "income" | "refund" | "transfer"; amountMinor: number; currency: string; date: string; time: string | null; tz: string | null; dateInferred: boolean;
  merchant: string; rawDescriptor: string | null; categoryId: number | null; categoryName: string | null; categoryIcon: string | null; categorySlot: number | null; subcategory: string | null;
  accountId: number | null; accountName: string | null; last4: string | null; transferAccountId: number | null; transferName: string | null; paymentMethod: string | null;
  note: string | null; source: string; needsReview: boolean; createdAt: string; isNew: boolean; recurring: boolean; rawSms: string | null; incomeLinked: boolean;
}
