CREATE INDEX IF NOT EXISTS "scrape_runs_started_at_idx"
ON "public"."scrape_runs" USING btree ("started_at");
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS "scraper_schedules_due_idx"
ON "public"."scraper_schedules" USING btree ("enabled", "next_run_at", "lease_until");
