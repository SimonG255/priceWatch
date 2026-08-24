ALTER TABLE `monitored_products` ADD COLUMN `confidence` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `evidence_json` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `page_etag` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `page_last_modified` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `last_http_status` integer;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `product_selector` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `ean_selector` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `price_selector` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `json_ld_ean_fields` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `json_ld_price_fields` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `json_ld_currency_fields` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `block_patterns` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `allow_rendered_fallback` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_sitemap_hints` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `hostname` text NOT NULL,
  `ean` text NOT NULL,
  `candidate_url` text NOT NULL,
  `sitemap_url` text,
  `sitemap_lastmod` text,
  `discovered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_verified_at` text,
  `expires_at` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scraper_sitemap_hints_host_ean_idx` ON `scraper_sitemap_hints` (`hostname`,`ean`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_domain_state` (
  `hostname` text PRIMARY KEY NOT NULL,
  `next_allowed_at` text,
  `backoff_until` text,
  `consecutive_failures` integer DEFAULT 0 NOT NULL,
  `total_checks` integer DEFAULT 0 NOT NULL,
  `blocked_checks` integer DEFAULT 0 NOT NULL,
  `unavailable_checks` integer DEFAULT 0 NOT NULL,
  `needs_review_checks` integer DEFAULT 0 NOT NULL,
  `last_outcome` text,
  `last_failure_kind` text,
  `last_profile_id` text,
  `last_checked_at` text,
  `last_success_at` text,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scraper_domain_state_updated_idx` ON `scraper_domain_state` (`updated_at`);
