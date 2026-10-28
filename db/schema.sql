CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS email_contacts (
  shop_domain TEXT NOT NULL,
  email TEXT NOT NULL,
  customer_id TEXT,
  first_name TEXT,
  marketing_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  suppressed_at TIMESTAMPTZ,
  suppression_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, email)
);

CREATE TABLE IF NOT EXISTS email_orders (
  shop_domain TEXT NOT NULL,
  order_id TEXT NOT NULL,
  email TEXT,
  customer_id TEXT,
  order_number TEXT,
  ordered_at TIMESTAMPTZ NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (shop_domain, order_id)
);

CREATE TABLE IF NOT EXISTS email_campaign_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain TEXT NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('abandoned_checkout', 'abandoned_checkout_follow_up', 'post_purchase_upsell')),
  source_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  payload JSONB NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  provider_message_id TEXT,
  skip_reason TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_domain, campaign_type, source_id)
);

CREATE INDEX IF NOT EXISTS email_campaign_jobs_due_idx
  ON email_campaign_jobs (status, due_at);

CREATE INDEX IF NOT EXISTS email_campaign_jobs_recipient_idx
  ON email_campaign_jobs (shop_domain, recipient_email, sent_at DESC);

CREATE TABLE IF NOT EXISTS email_campaign_settings (
  shop_domain TEXT NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('abandoned_checkout', 'abandoned_checkout_follow_up', 'post_purchase_upsell')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  delay_minutes INTEGER NOT NULL CHECK (delay_minutes BETWEEN 5 AND 43200),
  cooldown_days INTEGER NOT NULL DEFAULT 7 CHECK (cooldown_days BETWEEN 1 AND 90),
  subject TEXT NOT NULL,
  preheader TEXT NOT NULL,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  cta_label TEXT NOT NULL,
  cta_url TEXT NOT NULL,
  template_json JSONB NOT NULL DEFAULT '{"heroEnabled":true,"recommendationsEnabled":true,"footerEnabled":true}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, campaign_type)
);

-- Safe upgrades for the first two-flow release. Railway runs this schema on
-- every boot, so existing installations gain the follow-up path in place.
ALTER TABLE email_campaign_settings
  ADD COLUMN IF NOT EXISTS template_json JSONB NOT NULL
  DEFAULT '{"heroEnabled":true,"recommendationsEnabled":true,"footerEnabled":true}'::jsonb;

DO $$
DECLARE constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'email_campaign_jobs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%campaign_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE email_campaign_jobs DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE email_campaign_jobs
    ADD CONSTRAINT email_campaign_jobs_campaign_type_check
    CHECK (campaign_type IN ('abandoned_checkout', 'abandoned_checkout_follow_up', 'post_purchase_upsell'));
END $$;

DO $$
DECLARE constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'email_campaign_settings'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%campaign_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE email_campaign_settings DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE email_campaign_settings
    ADD CONSTRAINT email_campaign_settings_campaign_type_check
    CHECK (campaign_type IN ('abandoned_checkout', 'abandoned_checkout_follow_up', 'post_purchase_upsell'));
END $$;
