import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrations = [
  "0000_flimsy_colleen_wing.sql",
  "0001_admin_search_profiles.sql",
  "0002_scraper_reliability.sql",
  "0003_familiar_hercules.sql",
  "0004_spicy_terrax.sql",
];

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");

for (const migration of migrations) {
  database.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
}

const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
for (const table of ["price_snapshots", "scrape_runs", "scrape_attempts", "scraper_domain_cooldowns", "scraper_result_cache", "scraper_known_bad_patterns", "scraper_domain_policies", "scraper_schedules", "scraper_alert_rules", "scraper_alert_events"]) {
  assert.ok(tables.has(table), `Missing table ${table}`);
}

const productColumns = new Set(database.prepare("PRAGMA table_info(monitored_products)").all().map((row) => row.name));
for (const column of ["reason_code", "failure_class", "challenge_type", "confidence_scores_json", "last_duration_ms", "last_content_hash", "last_scan_id"]) {
  assert.ok(productColumns.has(column), `Missing monitored_products.${column}`);
}

const profileColumns = new Set(database.prepare("PRAGMA table_info(custom_search_profiles)").all().map((row) => row.name));
for (const column of ["revision", "site_type", "timeout_ms", "max_page_bytes", "retry_budget", "health_score", "last_seen_working_at", "drift_status"]) {
  assert.ok(profileColumns.has(column), `Missing custom_search_profiles.${column}`);
}

const scheduleColumns = new Set(database.prepare("PRAGMA table_info(scraper_schedules)").all().map((row) => row.name));
for (const column of ["cursor_index", "pending_outcome_json", "pending_started_at", "lease_token", "lease_until"]) {
  assert.ok(scheduleColumns.has(column), `Missing scraper_schedules.${column}`);
}

assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
console.log(`Verified ${migrations.length} migrations and ${tables.size} tables.`);
