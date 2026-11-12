# Folio

Personal finance and investments: bank-message understanding, budgets, income and scholarships,
a stock portfolio and an assistant that answers from your own records.

## Run locally

```bash
npm install
npm run build
npm start          # http://localhost:8787
```

Development with hot reload: `npm run dev` (web on 5173, API on 8787). Tests: `npm test`.

Without `DATABASE_URL`, Folio uses an embedded Postgres (PGlite) stored in `data/pglite`, so no
database server is needed locally. Set `DATABASE_URL` to run against Supabase instead (copy
`.env.example` to `.env.local` and export it).

## Deploy: Supabase + Vercel

**1. Supabase (database)**

1. Create a project at supabase.com.
2. Project → **Connect** → copy the **Transaction pooler** connection string (port 6543) and
   put your database password in it.
3. Optional: Project Settings → Database → **SSL Configuration** → download the certificate.

Folio creates its tables on first request. It does not use Supabase Auth or the Supabase client;
it connects to Postgres directly. Every table has row-level security switched on with no
policies, so Supabase's public Data API cannot read or write them — only the app's own
connection can, and the app scopes every query to the signed-in user.

**2. Vercel (app)**

1. Push the `folio` folder to a GitHub repository and import it in Vercel. The settings come
   from `vercel.json` (build `vite build`, output `dist`, API function `api/index.ts`).
2. Project → Settings → Environment Variables:
   - `DATABASE_URL` — the Supabase connection string from step 1.
   - `FOLIO_SECRET` — a long random string (`openssl rand -hex 32`). Keep it stable; it encrypts
     saved API keys.
   - `DATABASE_CA` — optional, the certificate contents from step 1, to verify the database server.
3. Deploy.

The function refuses to start without `DATABASE_URL` and `FOLIO_SECRET` on Vercel rather than
falling back to anything that would lose data.

## What needs your own keys (in the app's Settings)

- **Share prices, news, earnings**: an Alpha Vantage key.
- **Open-ended assistant answers**: an Anthropic API key. Without it the assistant still answers
  the common questions directly from your records.

## Getting bank messages in

A website cannot read SMS. Folio supports pasting, importing a file (text, JSON, Android SMS
backup XML), the Android share sheet once Folio is installed to the home screen, and a personal
endpoint (`POST /api/ingest/sms` with a bearer token) for an iOS Shortcuts automation or an
Android SMS-forwarder app. See the Automatic tab in the importer.

## Layout

- `server/app.ts` — the API (Express). `server/index.ts` runs it locally; `api/index.ts` is the
  Vercel function.
- `server/db.ts` — database access and schema (Supabase via `pg`, or PGlite locally).
- `shared/sms.ts` — the SMS parser; `shared/merchants.ts` — the merchant dictionary.
- `src/` — the web app; design tokens in `src/styles.css`.
- `docs/PLAN.md` — product rules and architecture.
