# Nexus

Nexus monitors public competitor product pages, verifies products by GTIN/EAN and name, records price and stock history, and sends price-drop, below-your-price, and restock alerts.

## What it does

- Saves public store websites and creates product–website monitoring searches.
- Uses store profiles, public search forms, sitemaps, and evidence-checked AI recovery to locate product pages.
- Preserves the last verified offer when a later request is blocked or temporarily unavailable.
- Compares verified offers by currency and stock status and exports products/history as CSV, JSON, or Excel.
- Runs Supabase Postgres-backed schedules with durable leases, per-domain throttling, cooldowns, and operational audit records.
- Supports Supabase email/password sessions.
- Enforces plan URL limits and maximum checks per day on the server.

Nexus only reads public HTTP(S) pages. It does not bypass logins, CAPTCHAs, paywalls, robots policy, or access challenges.

## Requirements

- Node.js 22.13 or newer
- npm

## Local development

```sh
npm install
npm run dev
```

`npm run dev` starts the Next.js development server at `http://localhost:3000`. Runtime data is stored in the configured Supabase Postgres database.

Useful commands:

```sh
npm run lint
npm run test:scraper
npm test
npm run build
npm run start
npm run audit:security
```

After changing `db/schema.ts`, add an idempotent SQL file to `drizzle-postgres/` and apply it with `npm run db:migrate`. The migration runner records applied files in `public.pricewatch_schema_migrations`, takes a PostgreSQL advisory lock, and runs each migration in one transaction. The older `drizzle/` folder is retained as the SQLite verification fixture and is not used by the production Postgres runner.

## Configuration

Copy `.env.example` to `.env.local` and fill only the services you use. Never commit `.env*` files.

Supabase email/password authentication:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
```

Use the connection string from Supabase Dashboard → Project Settings → Database → Connect. Add your local and production callback URLs under Supabase Auth URL Configuration. For local development:

```text
http://localhost:3000/auth/callback
```

Customer and admin email alerts use `ALERT_EMAIL_WEBHOOK_URL`. Customer payloads include `to`, `subject`, and `text`; configure this webhook to hand delivery to your SMTP/email provider. Users can set a target price, percentage-drop threshold, and restock notifications per site. Scraper-health Slack alerts use `SLACK_WEBHOOK_URL`. An approved JavaScript renderer can be configured with `SCRAPER_RENDERER_URL` and `SCRAPER_RENDERER_TOKEN`; its endpoint must be public HTTPS. A profile may optionally configure a simple `cookieConsentSelector` when rendered fallback is enabled. The renderer receives that selector with `cookieConsentAction: "accept_all"`; it must click only a visible same-site button whose text explicitly confirms accepting all cookies, and must never use it to bypass CAPTCHA, login, or access controls.

## Import format

Download `public/nexus-product-import-template.xlsx` from the dashboard. `Product Name` and a valid GTIN/EAN check digit are required. `SKU`, `Notes`, and `Your Price` are optional when present. A request may create at most 250 unique product–website combinations and is also bounded by the saved server-side plan.

## Persistence and hosting

Nexus uses Supabase Postgres through Drizzle. Set `DATABASE_URL` to the Supabase connection string; `DIRECT_URL` and the legacy `SUPABASE_DB_URL` names are also accepted by the server code. Apply schema migrations with `npm run db:migrate`.

## Security notes

- Product and renderer URLs reject credentials, nonstandard ports, localhost, private/reserved IPv4, private/link-local/reserved IPv6, and cross-store redirects.
- Every user-facing database query is scoped to the authenticated email.
- Spreadsheet exports neutralize formula-prefixed cells.
- Admin access is controlled by `ADMIN_EMAILS`.
- Before a commercial launch, configure the real operator/contact details, production SMTP/webhooks, hosting access policy, and billing.
