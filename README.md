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

## Production scraping safeguards

The scraper covers the ten production challenges from the Crawlbase checklist while keeping Nexus limited to public, permitted data:

1. **IP blocks and rate limits:** optional proxy pools, atomic per-domain reservations, bounded retries, `Retry-After` handling, jitter, and durable cooldowns.
2. **CAPTCHAs:** page and soft-wall detection stops the host immediately, records the challenge, and applies backoff; Nexus never invokes a CAPTCHA solver.
3. **JavaScript content:** an administrator can opt a store profile into the approved rendered-page service, with strict time, size, hostname, and verification limits.
4. **Dynamic/AJAX data:** Nexus reads JSON-LD, embedded application state such as `__NEXT_DATA__`, raw JSON search responses, and explicitly declared same-site public JSON endpoints. Token-bearing or authenticated endpoints are rejected.
5. **Site structure changes:** semantic extraction, required-field validation, content fingerprints, profile health scores, selector suggestions, drift alerts, and automatic disabling prevent silent bad prices.
6. **Fingerprint consistency:** one scan keeps a stable user-agent/proxy identity, consistent language and cache headers, and bounded anonymous same-host cookies. Identities rotate between scans, not in the middle of one session.
7. **Login walls:** login and authentication walls are classified as permanent public-access failures; credentials and private account pages are outside Nexus's scope.
8. **Honeypots:** link discovery is selective and ignores elements hidden by attributes, common hidden classes, inline CSS, stylesheet rules, zero-size/off-screen styles, or trap markers.
9. **Large batches:** products are stored as durable queued records and processed through leased, resumable schedules with fair per-domain batches; the protected cron route continues after a browser tab closes.
10. **Maintenance and monitoring:** the admin console exposes operational, blocked, CAPTCHA, challenge, rate-limit, throughput, median/P95 latency, profile-drift, audit, and alert data.

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

Customer and admin email alerts use `ALERT_EMAIL_WEBHOOK_URL`. Customer payloads include `to`, `subject`, and `text`; configure this webhook to hand delivery to your SMTP/email provider. Users can set a target price, percentage-drop threshold, and restock notifications per site. Scraper-health Slack alerts use `SLACK_WEBHOOK_URL`. Public scraper requests can optionally use a server-side `SCRAPER_USER_AGENTS` pool and `SCRAPER_PROXY_URLS` HTTP(S) proxy pool. Nexus chooses one pair per scan, keeps it stable for that scan, and chooses again for later scans; the default user-agent remains the identifiable Nexus agent and proxies are never exposed to the client. `SCRAPER_ACCEPT_LANGUAGE` controls the stable language header. An approved JavaScript renderer can be configured with `SCRAPER_RENDERER_URL` and `SCRAPER_RENDERER_TOKEN`; its endpoint must be public HTTPS. A profile may optionally configure a simple `cookieConsentSelector` when rendered fallback is enabled. The renderer receives that selector with `cookieConsentAction: "accept_all"`; it must click only a visible same-site button whose text explicitly confirms accepting all cookies, and must never use it to bypass CAPTCHA, login, or access controls.

Set a random `CRON_SECRET` of at least 16 characters in production. The included `vercel.json` calls `GET /api/cron/scraper` every minute, and Vercel sends the secret as `Authorization: Bearer …`. Per-minute cron requires a Vercel Pro or Enterprise project; on another host, invoke the same protected route from its scheduler. The route claims only due schedules, and database leases make overlapping invocations safe.

## Import format

Download `public/nexus-product-import-template.xlsx` from the dashboard. `Product Name` and a valid GTIN/EAN check digit are required. `SKU`, `Notes`, and `Your Price` are optional when present. If no websites are selected, Nexus uses the OpenAI web-search integration to discover public online stores from the product name and EAN, then verifies every result through the existing scraper before saving a price. Product-entry drafts and website selections are saved locally in the browser so an accidentally closed tab can be restored. A request may create at most 250 unique product–website combinations and is also bounded by the saved server-side plan.

## Persistence and hosting

Nexus uses Supabase Postgres through Drizzle. Set `DATABASE_URL` to the Supabase connection string; `DIRECT_URL` and the legacy `SUPABASE_DB_URL` names are also accepted by the server code. Apply schema migrations with `npm run db:migrate`.

## Security notes

- Product and renderer URLs reject credentials, nonstandard ports, localhost, private/reserved IPv4, private/link-local/reserved IPv6, and cross-store redirects.
- Every user-facing database query is scoped to the authenticated email.
- Spreadsheet exports neutralize formula-prefixed cells.
- Admin access is controlled by `ADMIN_EMAILS`.
- Before a commercial launch, configure the real operator/contact details, production SMTP/webhooks, hosting access policy, and billing.
