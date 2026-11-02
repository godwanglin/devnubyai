-- Add 24-hour upload size limits (in MB) for user uploads and AI agent uploads per plan
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "daily_upload_limit_mb" INTEGER,
  ADD COLUMN IF NOT EXISTS "daily_agent_upload_limit_mb" INTEGER;
