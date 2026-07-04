-- Conversation turn embeddings for pgvector semantic memory (v1).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS turn_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role varchar(20) NOT NULL,
  content_text text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS turn_embeddings_tenant_identity_idx
  ON turn_embeddings (tenant_id, identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS turn_embeddings_embedding_hnsw_idx
  ON turn_embeddings USING hnsw (embedding vector_cosine_ops);