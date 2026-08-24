ALTER TABLE `scraper_schedules` ADD `cursor_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scraper_schedules` ADD `pending_outcome_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `scraper_schedules` ADD `pending_started_at` text;--> statement-breakpoint
ALTER TABLE `scraper_schedules` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `scraper_schedules` ADD `lease_until` text;--> statement-breakpoint
PRAGMA optimize;
