import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let productsSchemaReady: Promise<void> | null = null;

export async function ensureProductsSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!productsSchemaReady) {
    productsSchemaReady = initializeProductsSchema().catch((error) => { productsSchemaReady = null; throw error; });
  }
  return productsSchemaReady;
}

async function initializeProductsSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS monitored_products (
      id text PRIMARY KEY NOT NULL,
      owner_email text NOT NULL,
      website_url text NOT NULL,
      product_name text NOT NULL,
      ean text NOT NULL,
      sku text DEFAULT '' NOT NULL,
      notes text DEFAULT '' NOT NULL,
      status text DEFAULT 'queued' NOT NULL,
      status_message text DEFAULT 'Ready to search' NOT NULL,
      matched_url text,
      result_title text,
      price_cents integer,
      currency text,
      in_stock integer,
      match_type text,
      confidence text,
      evidence_json text,
      page_etag text,
      page_last_modified text,
      last_http_status integer,
      last_checked_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS monitored_products_owner_idx ON monitored_products (owner_email)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS monitored_products_owner_url_ean_uidx ON monitored_products (owner_email, website_url, ean)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS monitored_websites (
      id text PRIMARY KEY NOT NULL,
      owner_email text NOT NULL,
      url text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS monitored_websites_owner_idx ON monitored_websites (owner_email)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS monitored_websites_owner_url_uidx ON monitored_websites (owner_email, url)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS custom_search_profiles (
      id text PRIMARY KEY NOT NULL,
      label text NOT NULL,
      hostname text DEFAULT '' NOT NULL,
      html_signature text DEFAULT '' NOT NULL,
      search_url_template text NOT NULL,
      product_selector text DEFAULT '' NOT NULL,
      ean_selector text DEFAULT '' NOT NULL,
      price_selector text DEFAULT '' NOT NULL,
      json_ld_ean_fields text DEFAULT '' NOT NULL,
      json_ld_price_fields text DEFAULT '' NOT NULL,
      json_ld_currency_fields text DEFAULT '' NOT NULL,
      block_patterns text DEFAULT '' NOT NULL,
      allow_rendered_fallback integer DEFAULT 0 NOT NULL,
      enabled integer DEFAULT 1 NOT NULL,
      created_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_sitemap_hints (
      cache_key text PRIMARY KEY NOT NULL,
      hostname text NOT NULL,
      ean text NOT NULL,
      candidate_url text NOT NULL,
      sitemap_url text,
      sitemap_lastmod text,
      discovered_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      last_verified_at text,
      expires_at text NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scraper_sitemap_hints_host_ean_idx ON scraper_sitemap_hints (hostname, ean)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_domain_state (
      hostname text PRIMARY KEY NOT NULL,
      next_allowed_at text,
      backoff_until text,
      consecutive_failures integer DEFAULT 0 NOT NULL,
      total_checks integer DEFAULT 0 NOT NULL,
      blocked_checks integer DEFAULT 0 NOT NULL,
      unavailable_checks integer DEFAULT 0 NOT NULL,
      needs_review_checks integer DEFAULT 0 NOT NULL,
      last_outcome text,
      last_failure_kind text,
      last_profile_id text,
      last_checked_at text,
      last_success_at text,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scraper_domain_state_updated_idx ON scraper_domain_state (updated_at)"),
  ]);
  await ensureColumns("monitored_products", [
    ["confidence", "confidence text"],
    ["evidence_json", "evidence_json text"],
    ["page_etag", "page_etag text"],
    ["page_last_modified", "page_last_modified text"],
    ["last_http_status", "last_http_status integer"],
  ]);
  await ensureColumns("custom_search_profiles", [
    ["product_selector", "product_selector text DEFAULT '' NOT NULL"],
    ["ean_selector", "ean_selector text DEFAULT '' NOT NULL"],
    ["price_selector", "price_selector text DEFAULT '' NOT NULL"],
    ["json_ld_ean_fields", "json_ld_ean_fields text DEFAULT '' NOT NULL"],
    ["json_ld_price_fields", "json_ld_price_fields text DEFAULT '' NOT NULL"],
    ["json_ld_currency_fields", "json_ld_currency_fields text DEFAULT '' NOT NULL"],
    ["block_patterns", "block_patterns text DEFAULT '' NOT NULL"],
    ["allow_rendered_fallback", "allow_rendered_fallback integer DEFAULT 0 NOT NULL"],
  ]);
}

async function ensureColumns(table: "monitored_products" | "custom_search_profiles", columns: readonly [string, string][]) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const existing = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set(existing.results.map((column) => column.name));
  const statements = columns
    .filter(([name]) => !names.has(name))
    .map(([, definition]) => env.DB!.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`));
  if (statements.length) await env.DB.batch(statements);
}
