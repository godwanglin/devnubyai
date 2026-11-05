-- Real error trace of a failed turn, kept apart from the friendly text the user sees,
-- plus the request id shown on the user's error card and searched in the admin panel.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "error_detail" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "request_id" VARCHAR(64);
