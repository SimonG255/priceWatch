ALTER TABLE public.monitored_products
  ADD COLUMN IF NOT EXISTS alert_target_price_cents integer;

ALTER TABLE public.monitored_products
  ADD COLUMN IF NOT EXISTS alert_drop_percent_bps integer;

ALTER TABLE public.monitored_products
  ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS monitored_products_owner_monitoring_idx
  ON public.monitored_products (owner_email, monitoring_enabled, updated_at);

