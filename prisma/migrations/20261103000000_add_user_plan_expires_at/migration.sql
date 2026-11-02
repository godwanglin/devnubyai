-- Paid plans expire: past this time the user is treated as the free plan.
-- Existing rows stay NULL (no expiry) so nobody is downgraded by this migration.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMPTZ(3);
