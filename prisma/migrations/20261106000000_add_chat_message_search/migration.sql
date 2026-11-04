-- Full-text search over a user's own chat messages for the `search_past_chats` tool.
-- `simple` config (no stemming, no stop words) so Indonesian and English match equally.
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_fts
  ON chat_messages USING GIN (to_tsvector('simple', content));
