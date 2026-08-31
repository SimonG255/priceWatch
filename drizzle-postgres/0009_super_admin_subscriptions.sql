ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial';

ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days');

ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

UPDATE public.user_plans
SET trial_ends_at = created_at::timestamptz + INTERVAL '14 days'
WHERE subscription_status = 'trial';

ALTER TABLE public.user_plans
  DROP CONSTRAINT IF EXISTS user_plans_subscription_status_check;

ALTER TABLE public.user_plans
  ADD CONSTRAINT user_plans_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'past_due', 'expired', 'cancelled'));

CREATE INDEX IF NOT EXISTS user_plans_subscription_expiry_idx
  ON public.user_plans (subscription_status, subscription_expires_at);
