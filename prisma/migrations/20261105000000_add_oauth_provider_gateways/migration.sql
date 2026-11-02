-- Add OAuth support to gateways table
ALTER TABLE "gateways" ADD COLUMN IF NOT EXISTS "auth_type" VARCHAR(16) NOT NULL DEFAULT 'api_key';
ALTER TABLE "gateways" ADD COLUMN IF NOT EXISTS "oauth_provider" VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_gateways_oauth_provider" ON "gateways"("oauth_provider");

-- Provider connections (multi-account pool per OAuth gateway)
CREATE TABLE IF NOT EXISTS "provider_connections" (
  "id" BIGSERIAL PRIMARY KEY,
  "gateway_id" BIGINT NOT NULL,
  "label" VARCHAR(120),
  "email" VARCHAR(320),
  "display_name" VARCHAR(160),
  "upstream_user_id" VARCHAR(128),
  "access_token_ciphertext" BYTEA NOT NULL,
  "refresh_token_ciphertext" BYTEA,
  "id_token_ciphertext" BYTEA,
  "scope" VARCHAR(512),
  "expires_at" TIMESTAMPTZ(3),
  "provider_data" JSONB,
  "quota_cached" JSONB,
  "quota_checked_at" TIMESTAMPTZ(3),
  "cooldown_until" TIMESTAMPTZ(3),
  "last_error" VARCHAR(500),
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "last_used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_provider_connections_gateway" FOREIGN KEY ("gateway_id") REFERENCES "gateways"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_provider_connections_pool" ON "provider_connections"("gateway_id", "is_enabled", "sort_order");
