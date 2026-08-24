import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const monitoredProducts = sqliteTable("monitored_products", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  websiteUrl: text("website_url").notNull(),
  productName: text("product_name").notNull(),
  ean: text("ean").notNull(),
  sku: text("sku").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("queued"),
  statusMessage: text("status_message").notNull().default("Ready to search"),
  matchedUrl: text("matched_url"),
  resultTitle: text("result_title"),
  priceCents: integer("price_cents"),
  currency: text("currency"),
  inStock: integer("in_stock", { mode: "boolean" }),
  matchType: text("match_type"),
  confidence: text("confidence"),
  evidenceJson: text("evidence_json"),
  pageEtag: text("page_etag"),
  pageLastModified: text("page_last_modified"),
  lastHttpStatus: integer("last_http_status"),
  lastCheckedAt: text("last_checked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("monitored_products_owner_idx").on(table.ownerEmail),
  uniqueIndex("monitored_products_owner_url_ean_uidx").on(table.ownerEmail, table.websiteUrl, table.ean),
]);

export const monitoredWebsites = sqliteTable("monitored_websites", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  url: text("url").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("monitored_websites_owner_idx").on(table.ownerEmail),
  uniqueIndex("monitored_websites_owner_url_uidx").on(table.ownerEmail, table.url),
]);

export const customSearchProfiles = sqliteTable("custom_search_profiles", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  hostname: text("hostname").notNull().default(""),
  htmlSignature: text("html_signature").notNull().default(""),
  searchUrlTemplate: text("search_url_template").notNull(),
  productSelector: text("product_selector").notNull().default(""),
  eanSelector: text("ean_selector").notNull().default(""),
  priceSelector: text("price_selector").notNull().default(""),
  jsonLdEanFields: text("json_ld_ean_fields").notNull().default(""),
  jsonLdPriceFields: text("json_ld_price_fields").notNull().default(""),
  jsonLdCurrencyFields: text("json_ld_currency_fields").notNull().default(""),
  blockPatterns: text("block_patterns").notNull().default(""),
  allowRenderedFallback: integer("allow_rendered_fallback", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const scraperSitemapHints = sqliteTable("scraper_sitemap_hints", {
  cacheKey: text("cache_key").primaryKey(),
  hostname: text("hostname").notNull(),
  ean: text("ean").notNull(),
  candidateUrl: text("candidate_url").notNull(),
  sitemapUrl: text("sitemap_url"),
  sitemapLastmod: text("sitemap_lastmod"),
  discoveredAt: text("discovered_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastVerifiedAt: text("last_verified_at"),
  expiresAt: text("expires_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("scraper_sitemap_hints_host_ean_idx").on(table.hostname, table.ean),
]);

export const scraperDomainState = sqliteTable("scraper_domain_state", {
  hostname: text("hostname").primaryKey(),
  nextAllowedAt: text("next_allowed_at"),
  backoffUntil: text("backoff_until"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  totalChecks: integer("total_checks").notNull().default(0),
  blockedChecks: integer("blocked_checks").notNull().default(0),
  unavailableChecks: integer("unavailable_checks").notNull().default(0),
  needsReviewChecks: integer("needs_review_checks").notNull().default(0),
  lastOutcome: text("last_outcome"),
  lastFailureKind: text("last_failure_kind"),
  lastProfileId: text("last_profile_id"),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("scraper_domain_state_updated_idx").on(table.updatedAt),
]);
