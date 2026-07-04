-- SunJet / Aelio v2 integration tables

CREATE TABLE IF NOT EXISTS convox_state_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  state_key varchar(255) NOT NULL,
  manifest jsonb NOT NULL,
  instance_id varchar(255),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, state_key)
);

CREATE INDEX IF NOT EXISTS convox_state_tenant ON convox_state_catalog (tenant_id);

CREATE TABLE IF NOT EXISTS memory_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  layer varchar(8) NOT NULL DEFAULT 'l0',
  intent_key varchar(255) NOT NULL DEFAULT '',
  phase varchar(100) NOT NULL DEFAULT '',
  body text NOT NULL,
  sunjet_row_id bigint,
  turn_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_episodes_identity ON memory_episodes (tenant_id, identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_episodes_sunjet_row ON memory_episodes (tenant_id, identity_id, sunjet_row_id);

CREATE TABLE IF NOT EXISTS outbox_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  identity_id uuid,
  channel varchar(32) NOT NULL DEFAULT 'convox_ws',
  event_type varchar(100) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status varchar(32) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  webhook_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_pending ON outbox_jobs (status, created_at) WHERE status = 'pending';