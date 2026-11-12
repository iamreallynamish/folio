# Folio — product and technical plan

## What was found before starting

- The project directory was empty: no existing code, portfolio data or integrations to reuse.
- No Apple-specific design skill was present in the build session, so the design system follows
  Apple's Human Interface Guidelines directly (see "Design system").
- An Alpha Vantage connector is linked to the owner's Claude account, so Alpha Vantage is the
  market-data provider. Holdings are entered or imported by the user; Folio ships with none.

## Product principles

1. **Nothing invented.** Every number on screen comes from a record the user created or imported,
   or from the market-data provider. Missing data is shown as missing ("Balance unavailable",
   "Price unavailable"), never filled in.
2. **Verified vs. estimated.** Currency conversions, recurring-payment detection and AI answers are
   labelled as estimates or AI-generated. Totals from records are labelled verified.
3. **Honest about the platform.** A web app cannot read SMS. Folio offers paste, file import,
   the Android share sheet (installed PWA) and a personal ingest endpoint for iOS Shortcuts or an
   Android SMS forwarder.

## Architecture

```
shared/   Pure TypeScript used by server, client and tests
  money.ts        currency minor units, formatting
  categories.ts   default categories
  merchants.ts    merchant dictionary → canonical name, category, kind
  sms.ts          SMS classifier + field extractor
server/   Express + Postgres (Supabase in production, PGlite locally), run with tsx
  db.ts           schema, connection and transactions
  auth.ts         scrypt passwords, hashed session tokens, CSRF header, rate limiting
  crypto.ts       AES-256-GCM for stored API keys
  services/       ingest (dedupe, balances, learning), summary (budget maths),
                  market (Alpha Vantage + cache), assistant (query engine + optional Claude)
  routes/         one router per domain; every query is scoped by user_id
src/      React + Vite client
  styles.css      design tokens and components
  ui/             Logo, WalletCard, Sheet, charts, icons, list rows
  screens/        Home, Activity, Budget (Plan), Income, Invest, Assistant, Settings
tests/    Parser and API tests (node:test)
```

Adding a feature means adding a route file, a screen and (if needed) a table; nothing is
cross-wired through global state.

## Data rules

- Amounts are integers in the currency's minor unit (JPY has none, INR has two decimals).
- A transaction keeps its original currency. Budget totals are in the user's base currency;
  other currencies are included only when the user has set an exchange rate, and are then
  flagged as estimates. Without a rate they are listed separately, not silently dropped.
- Transaction types: `expense`, `refund` (reduces spending in its category), `income`
  (money in from SMS, not counted as income until linked), `transfer` (never spending).
- Stored-value top-ups (Mobile Suica, PASMO, PayPay…) are transfers into a wallet account.
  Journeys recorded against the wallet are the expenses, so nothing is counted twice.
- Duplicates: identical SMS text, or same card + amount + currency + date + merchant where the
  times match or one is missing.
- Card balances change only when an SMS states a balance, or the user edits it, and never
  move backwards in time.
- Scholarship income is its own kind. Only `received` amounts count as received; expected
  payments are shown as outstanding.

## Design system (HIG)

- Type: system font stack (SF on Apple devices), Large Title 34 / Title 22 / Headline 17 /
  Body 17 / Subhead 15 / Footnote 13 / Caption 12, tabular figures for money.
- Layout: 4-pt spacing scale, 16-pt gutters, grouped inset lists, 44-pt minimum touch targets,
  safe-area insets, bottom tab bar on phones and a sidebar from 900 px.
- Colour: system grouped backgrounds, semantic label colours, light and dark modes, one accent.
  Chart colours are a colour-blind-checked categorical set in fixed order.
- Materials and motion: translucent bars, bottom sheets with a grabber, spring-like easing,
  all motion disabled under `prefers-reduced-motion`.

## Phases

1. Plan, tokens, logo, scaffold. ✔
2. SMS parser, merchant dictionary, tests against the four sample messages. ✔
3. Server: auth, schema, ingest/dedupe, transactions, accounts, categories, budgets. ✔
4. Client shell, Home (cards, since last visit), Activity (search, filters, edit, import). ✔
5. Budget charts, income and scholarships. ✔
6. Portfolio with Alpha Vantage, news and earnings. ✔
7. Assistant, settings, export, delete account. ✔

## Not built (candidates for later)

- Supabase Auth (Folio currently runs its own email/password sessions).
- Native Android wrapper with `READ_SMS` permission (the parser and API are ready for it).
- Automatic FX rates, multi-currency portfolio totals, brokerage sync, push notifications.
