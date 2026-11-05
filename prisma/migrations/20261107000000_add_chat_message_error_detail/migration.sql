-- Real error trace of a failed turn, kept apart from the friendly text the user sees.
-- Searched from the admin logs panel; never returned by the chat message API.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "error_detail" TEXT;
