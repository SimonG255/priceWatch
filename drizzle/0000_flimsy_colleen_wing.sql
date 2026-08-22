CREATE TABLE `monitored_products` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`website_url` text NOT NULL,
	`product_name` text NOT NULL,
	`ean` text NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`status_message` text DEFAULT 'Ready to search' NOT NULL,
	`matched_url` text,
	`result_title` text,
	`price_cents` integer,
	`currency` text,
	`in_stock` integer,
	`match_type` text,
	`last_checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `monitored_products_owner_idx` ON `monitored_products` (`owner_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitored_products_owner_url_ean_uidx` ON `monitored_products` (`owner_email`,`website_url`,`ean`);