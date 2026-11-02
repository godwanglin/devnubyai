-- Payment source per method/transaction; existing rows are DOKU
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "provider" VARCHAR(16) NOT NULL DEFAULT 'doku';

ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "provider" VARCHAR(16) NOT NULL DEFAULT 'doku';
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "provider_reference" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "idx_transactions_provider_ref" ON "payment_transactions"("provider", "provider_reference");
