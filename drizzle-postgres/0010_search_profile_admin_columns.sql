ALTER TABLE public.custom_search_profiles
  ADD COLUMN IF NOT EXISTS product_selector text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ean_selector text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS price_selector text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS json_ld_ean_fields text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS json_ld_price_fields text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS json_ld_currency_fields text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS block_patterns text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS allow_rendered_fallback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS site_type text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS timeout_ms integer,
  ADD COLUMN IF NOT EXISTS max_page_bytes integer,
  ADD COLUMN IF NOT EXISTS retry_budget integer,
  ADD COLUMN IF NOT EXISTS health_score integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS last_seen_working_at text,
  ADD COLUMN IF NOT EXISTS last_signature_seen_at text,
  ADD COLUMN IF NOT EXISTS drift_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS selector_suggestions_json text;

CREATE INDEX IF NOT EXISTS custom_search_profiles_host_enabled_idx
  ON public.custom_search_profiles (hostname, enabled);
