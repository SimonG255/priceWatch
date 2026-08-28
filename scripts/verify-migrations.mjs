import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrations = [
  "0000_flimsy_colleen_wing.sql",
  "0001_admin_search_profiles.sql",
  "0002_scraper_reliability.sql",
  "0003_familiar_hercules.sql",
  "0004_spicy_terrax.sql",
  "0005_lonely_silk_fever.sql",
  "0006_dizzy_omega_sentinel.sql",
  "0007_cookie_consent_selector.sql",
  "0008_monitoring_alerts.sql",
];

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");

for (const migration of migrations) {
  if (migration === "0005_lonely_silk_fever.sql") {
    database.prepare(`INSERT INTO monitored_products
      (id, owner_email, website_url, product_name, ean)
      VALUES ('legacy-host', 'legacy@example.com', 'https://www.legacy-store.example/item', 'Legacy', '0000000000000')`).run();
  }
  const migrationSql = readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
  database.exec(
    migration === "0007_cookie_consent_selector.sql"
      ? migrationSql.replace("ADD COLUMN IF NOT EXISTS", "ADD COLUMN")
      : migrationSql,
  );
}

const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name));
for (const table of ["price_snapshots", "scrape_runs", "scrape_attempts", "scraper_domain_cooldowns", "scraper_result_cache", "scraper_known_bad_patterns", "scraper_domain_policies", "scraper_schedules", "scraper_alert_rules", "scraper_alert_events"]) {
  assert.ok(tables.has(table), `Missing table ${table}`);
}

const productColumns = new Set(database.prepare("PRAGMA table_info(monitored_products)").all().map((row) => row.name));
for (const column of ["hostname", "reason_code", "failure_class", "challenge_type", "confidence_scores_json", "last_duration_ms", "last_content_hash", "last_scan_id", "alert_target_price_cents", "alert_drop_percent_bps", "monitoring_enabled"]) {
  assert.ok(productColumns.has(column), `Missing monitored_products.${column}`);
}
assert.equal(database.prepare("SELECT hostname FROM monitored_products WHERE id = 'legacy-host'").get().hostname, "legacy-store.example");

const profileColumns = new Set(database.prepare("PRAGMA table_info(custom_search_profiles)").all().map((row) => row.name));
for (const column of ["revision", "site_type", "timeout_ms", "max_page_bytes", "retry_budget", "health_score", "last_seen_working_at", "drift_status", "cookie_consent_selector"]) {
  assert.ok(profileColumns.has(column), `Missing custom_search_profiles.${column}`);
}

const scheduleColumns = new Set(database.prepare("PRAGMA table_info(scraper_schedules)").all().map((row) => row.name));
for (const column of ["cursor_index", "pending_outcome_json", "pending_started_at", "lease_token", "lease_until"]) {
  assert.ok(scheduleColumns.has(column), `Missing scraper_schedules.${column}`);
}

// Schedule selection is intentionally one JSON bind instead of 500 `IN (?)`
// binds, keeping the query parameter count bounded.
const insertProduct = database.prepare(`INSERT INTO monitored_products
  (id, owner_email, website_url, hostname, product_name, ean) VALUES (?, 'owner@example.com', ?, ?, 'Product', ?)`);
const selectedIds = [];
for (let index = 0; index < 500; index += 1) {
  const id = `product-${index}`;
  selectedIds.push(id);
  insertProduct.run(id, `https://store-${index % 7}.example/item/${index}`, `store-${index % 7}.example`, String(1_000_000_000_000 + index));
}
const selectedCount = database.prepare(`SELECT count(*) AS count FROM monitored_products
  WHERE owner_email = ? AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`)
  .get("owner@example.com", JSON.stringify(selectedIds)).count;
assert.equal(selectedCount, 500, "JSON-bound schedule selection did not include every product");

// The host reservation is a single conditional write on the success path.
const reserveDomain = database.prepare(`
  INSERT INTO scraper_domain_state (hostname, next_allowed_at, consecutive_failures, total_checks, blocked_checks, unavailable_checks, needs_review_checks, updated_at)
  SELECT ?, ?, 0, 0, 0, 0, 0, ?
  WHERE NOT EXISTS (
    SELECT 1 FROM scraper_domain_cooldowns WHERE hostname = ? AND cooldown_until > ?
  )
  ON CONFLICT(hostname) DO UPDATE SET
    next_allowed_at = excluded.next_allowed_at,
    updated_at = excluded.updated_at
  WHERE (scraper_domain_state.next_allowed_at IS NULL OR scraper_domain_state.next_allowed_at <= ?)
    AND (scraper_domain_state.backoff_until IS NULL OR scraper_domain_state.backoff_until <= ?)
    AND NOT EXISTS (
      SELECT 1 FROM scraper_domain_cooldowns WHERE hostname = ? AND cooldown_until > ?
    )
`);
const reservationNow = new Date().toISOString();
const reservationFuture = new Date(Date.now() + 60_000).toISOString();
assert.equal(reserveDomain.run("store.example", reservationFuture, reservationNow, "store.example", reservationNow, reservationNow, reservationNow, "store.example", reservationNow).changes, 1);
assert.equal(reserveDomain.run("store.example", reservationFuture, reservationNow, "store.example", reservationNow, reservationNow, reservationNow, "store.example", reservationNow).changes, 0);

// Audit inserts use an existence guard so an in-flight scan cannot recreate
// history after its product has been deleted.
database.prepare(`INSERT INTO scrape_runs (id, owner_email, product_id, trigger, hostname, started_at)
  VALUES ('run-guard', 'owner@example.com', 'product-0', 'manual', 'store.example', CURRENT_TIMESTAMP)`).run();
database.prepare("DELETE FROM monitored_products WHERE id = 'product-0'").run();
database.prepare(`INSERT OR IGNORE INTO price_snapshots (
  id, owner_email, product_id, scan_id, ean, hostname, matched_url, price_cents,
  currency, in_stock, exact_ean, name_similarity_bps, price_confidence,
  source_confidence, overall_confidence, price_source, content_hash, captured_at
) SELECT 'snapshot-guard', 'owner@example.com', 'product-0', 'run-guard', '000',
  'store.example', 'https://store.example/item', 100, 'EUR', 1, 1, 10000, 100,
  100, 100, 'json_ld', 'hash', CURRENT_TIMESTAMP
  WHERE EXISTS (
    SELECT 1 FROM scrape_runs AS run
    JOIN monitored_products AS product ON product.id = 'product-0' AND product.owner_email = 'owner@example.com'
    WHERE run.id = 'run-guard' AND run.owner_email = 'owner@example.com'
  )`).run();
assert.equal(database.prepare("SELECT count(*) AS count FROM price_snapshots WHERE id = 'snapshot-guard'").get().count, 0);

assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
console.log(`Verified ${migrations.length} migrations and ${tables.size} tables.`);
