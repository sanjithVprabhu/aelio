-- Persistent mock SaaS data for manual Convox demos (demo customer backend handlers).

CREATE TABLE IF NOT EXISTS demo_saas_accounts (
  external_user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'pro',
  seats INT NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'active',
  api_access BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_saas_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_user_id TEXT NOT NULL REFERENCES demo_saas_accounts(external_user_id) ON DELETE CASCADE,
  report TEXT NOT NULL,
  recipient TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'weekly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_saas_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_user_id TEXT NOT NULL REFERENCES demo_saas_accounts(external_user_id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  member TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'view',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_saas_reports_user_idx ON demo_saas_reports(external_user_id);
CREATE INDEX IF NOT EXISTS demo_saas_shares_user_idx ON demo_saas_shares(external_user_id);
