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
    productsSchemaReady = env.DB.batch([
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
        enabled integer DEFAULT 1 NOT NULL,
        created_by text NOT NULL,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`),
    ]).then(() => undefined).catch((error) => { productsSchemaReady = null; throw error; });
  }
  return productsSchemaReady;
}
