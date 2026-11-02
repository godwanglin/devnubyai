-- Cap on concurrent AI generations per user, managed per plan from the admin panel.
-- Free gets 1, every other existing plan 3; NULL/0 falls back to 3 in code.
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "max_parallel_requests" INTEGER;

UPDATE "plans" SET "max_parallel_requests" = CASE WHEN "slug" = 'free' THEN 1 ELSE 3 END
WHERE "max_parallel_requests" IS NULL;
