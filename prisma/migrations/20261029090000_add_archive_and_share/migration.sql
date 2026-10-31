-- Add archive state and public read-only share token to chat_sessions
ALTER TABLE `chat_sessions`
  ADD COLUMN `is_archived` BOOLEAN NOT NULL DEFAULT false AFTER `is_pinned`,
  ADD COLUMN `share_token` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER `is_archived`,
  ADD COLUMN `shared_at` DATETIME(3) NULL AFTER `share_token`,
  ADD UNIQUE INDEX `uq_chat_sessions_share_token`(`share_token`),
  ADD INDEX `idx_chat_sessions_archived`(`user_id`, `is_archived`, `last_message_at` DESC, `id` DESC);
