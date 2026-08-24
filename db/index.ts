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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_domain_cooldowns (
      hostname text NOT NULL,
      reason_code text NOT NULL,
      failure_class text NOT NULL,
      consecutive_failures integer DEFAULT 0 NOT NULL,
      retry_budget_remaining integer DEFAULT 3 NOT NULL,
      cooldown_until text NOT NULL,
      last_seen_at text NOT NULL,
      PRIMARY KEY (hostname, reason_code)
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scraper_domain_cooldowns_active_idx ON scraper_domain_cooldowns (hostname, cooldown_until)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS price_snapshots (
      id text PRIMARY KEY NOT NULL, owner_email text NOT NULL, product_id text NOT NULL, scan_id text NOT NULL,
      ean text NOT NULL, hostname text NOT NULL, matched_url text NOT NULL, price_cents integer NOT NULL,
      currency text NOT NULL, in_stock integer, exact_ean integer DEFAULT 0 NOT NULL,
      name_similarity_bps integer DEFAULT 0 NOT NULL, price_confidence integer DEFAULT 0 NOT NULL,
      source_confidence integer DEFAULT 0 NOT NULL, overall_confidence integer DEFAULT 0 NOT NULL,
      price_source text, content_hash text, captured_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS price_snapshots_scan_uidx ON price_snapshots (scan_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS price_snapshots_owner_product_time_idx ON price_snapshots (owner_email, product_id, captured_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS price_snapshots_owner_ean_offer_idx ON price_snapshots (owner_email, ean, currency, in_stock, price_cents, captured_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scrape_runs (
      id text PRIMARY KEY NOT NULL, owner_email text NOT NULL, product_id text, schedule_id text,
      trigger text DEFAULT 'manual' NOT NULL, hostname text NOT NULL, profile_id text,
      status text DEFAULT 'running' NOT NULL, reason_code text, failure_class text, challenge_type text,
      message text, duration_ms integer, attempt_count integer DEFAULT 0 NOT NULL, matched_url text,
      result_title text, price_cents integer, currency text, in_stock integer, exact_ean integer DEFAULT 0 NOT NULL,
      name_similarity_bps integer, confidence_scores_json text, http_status integer,
      started_at text NOT NULL, completed_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scrape_runs_owner_product_time_idx ON scrape_runs (owner_email, product_id, started_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scrape_runs_hostname_time_idx ON scrape_runs (hostname, started_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scrape_runs_status_reason_time_idx ON scrape_runs (status, reason_code, started_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scrape_runs_profile_time_idx ON scrape_runs (profile_id, started_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scrape_attempts (
      id text PRIMARY KEY NOT NULL, run_id text NOT NULL, owner_email text NOT NULL, ordinal integer NOT NULL,
      url text NOT NULL, hostname text NOT NULL, profile_id text, profile_label text, outcome text NOT NULL,
      reason_code text NOT NULL, failure_class text NOT NULL, challenge_type text, http_status integer,
      duration_ms integer NOT NULL, response_bytes integer, content_hash text, message text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS scrape_attempts_run_ordinal_uidx ON scrape_attempts (run_id, ordinal)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scrape_attempts_owner_time_idx ON scrape_attempts (owner_email, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scrape_attempts_host_time_idx ON scrape_attempts (hostname, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scrape_attempts_reason_time_idx ON scrape_attempts (reason_code, created_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_result_cache (
      cache_key text PRIMARY KEY NOT NULL, normalized_url text NOT NULL, hostname text NOT NULL, ean text NOT NULL,
      content_hash text NOT NULL, result_json text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      expires_at text NOT NULL, last_used_at text, hit_count integer DEFAULT 0 NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS scraper_result_cache_identity_uidx ON scraper_result_cache (normalized_url, ean, content_hash)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scraper_result_cache_host_ean_expiry_idx ON scraper_result_cache (hostname, ean, expires_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_known_bad_patterns (
      id text PRIMARY KEY NOT NULL, hostname text NOT NULL, url_pattern text, content_pattern text, reason text NOT NULL,
      failure_class text DEFAULT 'permanent' NOT NULL, enabled integer DEFAULT 1 NOT NULL, expires_at text,
      hit_count integer DEFAULT 0 NOT NULL, last_hit_at text, created_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scraper_known_bad_host_enabled_idx ON scraper_known_bad_patterns (hostname, enabled)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_domain_policies (
      hostname text PRIMARY KEY NOT NULL, access_mode text DEFAULT 'allow' NOT NULL, robots_mode text DEFAULT 'respect' NOT NULL,
      site_type text DEFAULT 'auto' NOT NULL, request_interval_ms integer, timeout_ms integer, max_page_bytes integer,
      retry_budget integer, block_reason text, notes text, updated_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_schedules (
      id text PRIMARY KEY NOT NULL, owner_email text NOT NULL, name text NOT NULL, target_mode text DEFAULT 'all' NOT NULL,
      product_ids_json text DEFAULT '[]' NOT NULL, cadence_minutes integer NOT NULL, time_zone text DEFAULT 'UTC' NOT NULL,
      enabled integer DEFAULT 1 NOT NULL, next_run_at text NOT NULL, last_run_at text, last_outcome text,
      cursor_index integer DEFAULT 0 NOT NULL, pending_outcome_json text DEFAULT '{}' NOT NULL,
      pending_started_at text, lease_token text, lease_until text,
      revision integer DEFAULT 1 NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scraper_schedules_owner_due_idx ON scraper_schedules (owner_email, enabled, next_run_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_alert_rules (
      id text PRIMARY KEY NOT NULL, hostname text, enabled integer DEFAULT 1 NOT NULL, minimum_checks integer DEFAULT 5 NOT NULL,
      minimum_success_rate_bps integer DEFAULT 8000 NOT NULL, maximum_consecutive_failures integer DEFAULT 3 NOT NULL,
      channel text DEFAULT 'slack' NOT NULL, destination_ref text DEFAULT 'default' NOT NULL,
      cooldown_minutes integer DEFAULT 60 NOT NULL, last_evaluated_at text, created_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_alert_events (
      id text PRIMARY KEY NOT NULL, rule_id text NOT NULL, hostname text NOT NULL, state text DEFAULT 'open' NOT NULL,
      dedupe_key text NOT NULL, observed_json text NOT NULL, message text NOT NULL, first_detected_at text NOT NULL,
      last_detected_at text NOT NULL, sent_at text, resolved_at text, delivery_error text
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS scraper_alert_events_dedupe_uidx ON scraper_alert_events (dedupe_key)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS scraper_alert_events_host_state_time_idx ON scraper_alert_events (hostname, state, last_detected_at)"),
  ]);
  await ensureColumns("monitored_products", [
    ["confidence", "confidence text"],
    ["evidence_json", "evidence_json text"],
    ["page_etag", "page_etag text"],
    ["page_last_modified", "page_last_modified text"],
    ["last_http_status", "last_http_status integer"],
    ["reason_code", "reason_code text"],
    ["failure_class", "failure_class text"],
    ["challenge_type", "challenge_type text"],
    ["confidence_scores_json", "confidence_scores_json text"],
    ["last_duration_ms", "last_duration_ms integer"],
    ["last_content_hash", "last_content_hash text"],
    ["last_scan_id", "last_scan_id text"],
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
    ["revision", "revision integer DEFAULT 1 NOT NULL"],
    ["site_type", "site_type text DEFAULT 'auto' NOT NULL"],
    ["timeout_ms", "timeout_ms integer"],
    ["max_page_bytes", "max_page_bytes integer"],
    ["retry_budget", "retry_budget integer"],
    ["health_score", "health_score integer DEFAULT 50 NOT NULL"],
    ["last_seen_working_at", "last_seen_working_at text"],
    ["last_signature_seen_at", "last_signature_seen_at text"],
    ["drift_status", "drift_status text DEFAULT 'unknown' NOT NULL"],
    ["selector_suggestions_json", "selector_suggestions_json text"],
  ]);
  await ensureColumns("scraper_domain_state", [
    ["backoff_exponent", "backoff_exponent integer DEFAULT 0 NOT NULL"],
    ["retry_budget_remaining", "retry_budget_remaining integer DEFAULT 3 NOT NULL"],
    ["cooldown_reason", "cooldown_reason text"],
    ["failure_class", "failure_class text"],
    ["last_reason_code", "last_reason_code text"],
    ["last_challenge_type", "last_challenge_type text"],
    ["successful_checks", "successful_checks integer DEFAULT 0 NOT NULL"],
    ["not_found_checks", "not_found_checks integer DEFAULT 0 NOT NULL"],
    ["temporary_failure_checks", "temporary_failure_checks integer DEFAULT 0 NOT NULL"],
    ["permanent_failure_checks", "permanent_failure_checks integer DEFAULT 0 NOT NULL"],
    ["challenge_checks", "challenge_checks integer DEFAULT 0 NOT NULL"],
    ["total_response_ms", "total_response_ms integer DEFAULT 0 NOT NULL"],
    ["response_samples", "response_samples integer DEFAULT 0 NOT NULL"],
    ["last_response_ms", "last_response_ms integer"],
    ["health_score", "health_score integer DEFAULT 100 NOT NULL"],
  ]);
  await ensureColumns("scraper_schedules", [
    ["cursor_index", "cursor_index integer DEFAULT 0 NOT NULL"],
    ["pending_outcome_json", "pending_outcome_json text DEFAULT '{}' NOT NULL"],
    ["pending_started_at", "pending_started_at text"],
    ["lease_token", "lease_token text"],
    ["lease_until", "lease_until text"],
  ]);
  await env.DB.batch([
    env.DB.prepare("CREATE INDEX IF NOT EXISTS monitored_products_owner_ean_offer_idx ON monitored_products (owner_email, ean, status, currency, in_stock, price_cents)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS custom_search_profiles_host_enabled_idx ON custom_search_profiles (hostname, enabled)"),
  ]);
}

async function ensureColumns(table: "monitored_products" | "custom_search_profiles" | "scraper_domain_state" | "scraper_schedules", columns: readonly [string, string][]) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const existing = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set(existing.results.map((column: { name: string }) => column.name));
  const statements = columns
    .filter(([name]) => !names.has(name))
    .map(([, definition]) => env.DB!.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`));
  if (statements.length) await env.DB.batch(statements);
}
