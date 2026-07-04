CREATE TABLE IF NOT EXISTS convox_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  objective_key varchar(255) NOT NULL,
  state_key varchar(100) NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]',
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, state_key, objective_key)
);