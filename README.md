# PriceWatch

A competitor price monitoring dashboard built with React, Vinext, and Vite.

## Product workflow

Each monitored product has three required fields:

- a public website or product-page URL
- the product name
- an EAN-8, UPC-A, EAN-13, or GTIN-14 barcode

The dashboard searches likely same-site public pages, prioritizes exact EAN
matches, and stores the matched URL, title, price, currency, availability, and
check status in D1. It does not bypass logins, CAPTCHAs, paywalls, or blocked
requests.

## Website search profiles

Stores use different search paths and parameter names. PriceWatch first reads a
public GET search form from the submitted website and uses its action, query
field, and safe fixed fields. When no usable form is published, the central
profile list in `lib/site-search-profiles.ts` supports known domain routes and
Shopify, Magento, WooCommerce, PrestaShop, BigCommerce, and Shopware patterns,
followed by conservative `q`, `query`, `search`, and `s` fallbacks. Add a
confirmed store-specific route to that one file rather than changing the
crawler.

For bulk entry, first save the websites in the dashboard, then download
`public/pricewatch-product-import-template.xlsx`, add only the product name and
EAN for each row, and import the workbook. Every imported product is searched on
all of the user's saved websites. Imports support
up to 250 products per file, subject to the selected plan limit. Export creates
an Excel workbook containing both the source product fields and latest search
results.

## Run locally

The development server works on Windows, macOS, and Linux.

```sh
npm install
npm run dev
```

Then open the local address shown in the terminal, normally
`http://localhost:5173`.

## Email and password authentication

PriceWatch is prepared for Supabase Auth. Create a Supabase project, copy
`.env.example` to `.env.local`, and set:

```sh
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

In Supabase Auth URL Configuration, set the Site URL to your PriceWatch domain
and allow these redirect URLs:

```text
http://127.0.0.1:5173/auth/callback
https://pricewatch-monitor.simongajsek6.chatgpt.site/auth/callback
```

Email confirmation should remain enabled. Configure custom SMTP before a public
launch; Supabase's default email sender is intended for limited testing.

On Windows, use a current 64-bit Node.js release. Node.js `22.13` or newer is
required. If you downloaded an older archive, delete `node_modules`, download
the corrected archive, and run the two commands above again.

## Prerequisites

- Node.js `>=22.13.0`
- Windows, macOS, or Linux for local development
- Linux with `flock`, `curl`, and GNU `timeout` only for the hosted validation scripts

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` defines the per-account monitored product catalogue
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build and verify the rendered development-preview metadata
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
