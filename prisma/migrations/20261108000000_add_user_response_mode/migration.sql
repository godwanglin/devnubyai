-- Settings > Appearance > Response display: how much of a reply's work the chat shows
-- (verbose | normal | silent); null means the default, normal.
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "response_mode" VARCHAR(16);
