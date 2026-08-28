ALTER TABLE public.custom_search_profiles
  ADD COLUMN IF NOT EXISTS cookie_consent_selector text NOT NULL DEFAULT '';

