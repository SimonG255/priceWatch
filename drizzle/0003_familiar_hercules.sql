ALTER TABLE `monitored_products` ADD COLUMN `reason_code` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `failure_class` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `challenge_type` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `confidence_scores_json` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `last_duration_ms` integer;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `last_content_hash` text;
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD COLUMN `last_scan_id` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `monitored_products_owner_ean_offer_idx` ON `monitored_products` (`owner_email`,`ean`,`status`,`currency`,`in_stock`,`price_cents`);
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `site_type` text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `timeout_ms` integer;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `max_page_bytes` integer;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `retry_budget` integer;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `health_score` integer DEFAULT 50 NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `last_seen_working_at` text;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `last_signature_seen_at` text;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `drift_status` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `custom_search_profiles` ADD COLUMN `selector_suggestions_json` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `custom_search_profiles_host_enabled_idx` ON `custom_search_profiles` (`hostname`,`enabled`);
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `backoff_exponent` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `retry_budget_remaining` integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `cooldown_reason` text;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `failure_class` text;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `last_reason_code` text;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `last_challenge_type` text;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `successful_checks` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `not_found_checks` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `temporary_failure_checks` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `permanent_failure_checks` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `challenge_checks` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `total_response_ms` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `response_samples` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `last_response_ms` integer;
--> statement-breakpoint
ALTER TABLE `scraper_domain_state` ADD COLUMN `health_score` integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_domain_cooldowns` (
	`hostname` text NOT NULL,
	`reason_code` text NOT NULL,
	`failure_class` text NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`retry_budget_remaining` integer DEFAULT 3 NOT NULL,
	`cooldown_until` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`hostname`, `reason_code`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scraper_domain_cooldowns_active_idx` ON `scraper_domain_cooldowns` (`hostname`,`cooldown_until`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`product_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`ean` text NOT NULL,
	`hostname` text NOT NULL,
	`matched_url` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`in_stock` integer,
	`exact_ean` integer DEFAULT 0 NOT NULL,
	`name_similarity_bps` integer DEFAULT 0 NOT NULL,
	`price_confidence` integer DEFAULT 0 NOT NULL,
	`source_confidence` integer DEFAULT 0 NOT NULL,
	`overall_confidence` integer DEFAULT 0 NOT NULL,
	`price_source` text,
	`content_hash` text,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `price_snapshots_scan_uidx` ON `price_snapshots` (`scan_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `price_snapshots_owner_product_time_idx` ON `price_snapshots` (`owner_email`,`product_id`,`captured_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `price_snapshots_owner_ean_offer_idx` ON `price_snapshots` (`owner_email`,`ean`,`currency`,`in_stock`,`price_cents`,`captured_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scrape_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`product_id` text,
	`schedule_id` text,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`hostname` text NOT NULL,
	`profile_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`reason_code` text,
	`failure_class` text,
	`challenge_type` text,
	`message` text,
	`duration_ms` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`matched_url` text,
	`result_title` text,
	`price_cents` integer,
	`currency` text,
	`in_stock` integer,
	`exact_ean` integer DEFAULT 0 NOT NULL,
	`name_similarity_bps` integer,
	`confidence_scores_json` text,
	`http_status` integer,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scrape_runs_owner_product_time_idx` ON `scrape_runs` (`owner_email`,`product_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scrape_runs_hostname_time_idx` ON `scrape_runs` (`hostname`,`started_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scrape_runs_status_reason_time_idx` ON `scrape_runs` (`status`,`reason_code`,`started_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scrape_runs_profile_time_idx` ON `scrape_runs` (`profile_id`,`started_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scrape_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`ordinal` integer NOT NULL,
	`url` text NOT NULL,
	`hostname` text NOT NULL,
	`profile_id` text,
	`profile_label` text,
	`outcome` text NOT NULL,
	`reason_code` text NOT NULL,
	`failure_class` text NOT NULL,
	`challenge_type` text,
	`http_status` integer,
	`duration_ms` integer NOT NULL,
	`response_bytes` integer,
	`content_hash` text,
	`message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `scrape_attempts_run_ordinal_uidx` ON `scrape_attempts` (`run_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scrape_attempts_owner_time_idx` ON `scrape_attempts` (`owner_email`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scrape_attempts_host_time_idx` ON `scrape_attempts` (`hostname`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scrape_attempts_reason_time_idx` ON `scrape_attempts` (`reason_code`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_result_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`normalized_url` text NOT NULL,
	`hostname` text NOT NULL,
	`ean` text NOT NULL,
	`content_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`hit_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `scraper_result_cache_identity_uidx` ON `scraper_result_cache` (`normalized_url`,`ean`,`content_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scraper_result_cache_host_ean_expiry_idx` ON `scraper_result_cache` (`hostname`,`ean`,`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_known_bad_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`url_pattern` text,
	`content_pattern` text,
	`reason` text NOT NULL,
	`failure_class` text DEFAULT 'permanent' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`expires_at` text,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_hit_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scraper_known_bad_host_enabled_idx` ON `scraper_known_bad_patterns` (`hostname`,`enabled`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_domain_policies` (
	`hostname` text PRIMARY KEY NOT NULL,
	`access_mode` text DEFAULT 'allow' NOT NULL,
	`robots_mode` text DEFAULT 'respect' NOT NULL,
	`site_type` text DEFAULT 'auto' NOT NULL,
	`request_interval_ms` integer,
	`timeout_ms` integer,
	`max_page_bytes` integer,
	`retry_budget` integer,
	`block_reason` text,
	`notes` text,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`target_mode` text DEFAULT 'all' NOT NULL,
	`product_ids_json` text DEFAULT '[]' NOT NULL,
	`cadence_minutes` integer NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`next_run_at` text NOT NULL,
	`last_run_at` text,
	`last_outcome` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scraper_schedules_owner_due_idx` ON `scraper_schedules` (`owner_email`,`enabled`,`next_run_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`hostname` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`minimum_checks` integer DEFAULT 5 NOT NULL,
	`minimum_success_rate_bps` integer DEFAULT 8000 NOT NULL,
	`maximum_consecutive_failures` integer DEFAULT 3 NOT NULL,
	`channel` text DEFAULT 'slack' NOT NULL,
	`destination_ref` text DEFAULT 'default' NOT NULL,
	`cooldown_minutes` integer DEFAULT 60 NOT NULL,
	`last_evaluated_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scraper_alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`hostname` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`dedupe_key` text NOT NULL,
	`observed_json` text NOT NULL,
	`message` text NOT NULL,
	`first_detected_at` text NOT NULL,
	`last_detected_at` text NOT NULL,
	`sent_at` text,
	`resolved_at` text,
	`delivery_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `scraper_alert_events_dedupe_uidx` ON `scraper_alert_events` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scraper_alert_events_host_state_time_idx` ON `scraper_alert_events` (`hostname`,`state`,`last_detected_at`);
--> statement-breakpoint
PRAGMA optimize;
