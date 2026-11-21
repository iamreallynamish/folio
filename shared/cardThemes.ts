/**
 * A look for a newly added card: the matching card art where Folio has it (ICICI forex, Axis Privilege),
 * otherwise the next colour in turn, so a user's cards don't all come out the same.
 */
export const GENERIC_THEMES = ["graphite", "ocean", "plum", "ember", "mint", "sand"];
export function suggestTheme(bank: string | null | undefined, cardType: string | null | undefined, existingCount: number): string {
  const b = (bank ?? "").toLowerCase(), t = (cardType ?? "").toLowerCase();
  if (b.includes("icici") && /forex/.test(t)) return "icici-student";
  if (b.includes("axis") && /privilege/.test(t)) return "axis-privilege";
  return GENERIC_THEMES[existingCount % GENERIC_THEMES.length];
}
