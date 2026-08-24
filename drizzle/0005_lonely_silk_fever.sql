ALTER TABLE `monitored_products` ADD `hostname` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `monitored_products`
SET `hostname` = lower(replace(
  substr(
    substr(`website_url`, instr(`website_url`, '://') + 3),
    1,
    instr(substr(`website_url`, instr(`website_url`, '://') + 3) || '/', '/') - 1
  ),
  'www.',
  ''
))
WHERE `hostname` = '';--> statement-breakpoint
CREATE INDEX `monitored_products_owner_host_checked_idx` ON `monitored_products` (`owner_email`,`hostname`,`last_checked_at`,`created_at`);
PRAGMA optimize;
