ALTER TABLE "monitored_products" ADD COLUMN "alert_target_price_cents" integer;
--> statement-breakpoint
ALTER TABLE "monitored_products" ADD COLUMN "alert_drop_percent_bps" integer;
--> statement-breakpoint
ALTER TABLE "monitored_products" ADD COLUMN "monitoring_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitored_products_owner_monitoring_idx" ON "monitored_products" ("owner_email","monitoring_enabled","updated_at");
