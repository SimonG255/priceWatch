CREATE TABLE `customer_alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`product_id` text NOT NULL,
	`alert_type` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`dedupe_key` text NOT NULL,
	`message` text NOT NULL,
	`previous_value_json` text,
	`current_value_json` text NOT NULL,
	`detected_at` text NOT NULL,
	`sent_at` text,
	`delivery_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_alert_events_dedupe_uidx` ON `customer_alert_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `customer_alert_events_owner_time_idx` ON `customer_alert_events` (`owner_email`,`detected_at`);--> statement-breakpoint
CREATE INDEX `customer_alert_events_product_time_idx` ON `customer_alert_events` (`product_id`,`detected_at`);--> statement-breakpoint
CREATE TABLE `user_plans` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`plan_key` text DEFAULT 'business' NOT NULL,
	`url_limit` integer DEFAULT 150 NOT NULL,
	`checks_per_day` integer DEFAULT 4 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `monitored_products` ADD `own_price_cents` integer;--> statement-breakpoint
ALTER TABLE `monitored_products` ADD `alert_on_price_drop` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `monitored_products` ADD `alert_on_restock` integer DEFAULT true NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `monitored_websites` (`id`, `owner_email`, `url`, `created_at`)
SELECT lower(hex(randomblob(16))), `owner_email`, `website_url`, MIN(`created_at`)
FROM `monitored_products`
GROUP BY `owner_email`, `website_url`;
