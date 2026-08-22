CREATE TABLE `monitored_websites` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`url` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `monitored_websites_owner_idx` ON `monitored_websites` (`owner_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitored_websites_owner_url_uidx` ON `monitored_websites` (`owner_email`,`url`);--> statement-breakpoint
CREATE TABLE `custom_search_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`hostname` text DEFAULT '' NOT NULL,
	`html_signature` text DEFAULT '' NOT NULL,
	`search_url_template` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
