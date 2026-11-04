/**
 * Checks `search_past_chats` never returns another user's chats, by running the
 * real tool for a word that appears in chats of several users. Read-only apart
 * from CREATE INDEX IF NOT EXISTS (same SQL as the migration).
 * Run with: npx tsx scripts/test-chat-search.ts [word]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/client";
import { db } from "../src/lib/db";
import { searchPastChatsTool } from "../src/lib/tools/search-past-chats";

async function ensureIndex() {
  const sql = readFileSync("prisma/migrations/20261106000000_add_chat_message_search/migration.sql", "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  await db.$executeRawUnsafe(sql);
}

/** Users (with their unlocked chats) whose messages contain `word`. */
async function ownersOf(word: string) {
  return db.$queryRaw<{ userId: bigint; publicId: string; sessionPublicId: string; chats: bigint }[]>(Prisma.sql`
    SELECT s.user_id AS "userId",
           u.public_id AS "publicId",
           MIN(s.public_id) AS "sessionPublicId",
           COUNT(DISTINCT s.id) AS chats
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    JOIN users u ON u.id = s.user_id
    WHERE s.is_locked = false
      AND m.status IN ('completed', 'aborted')
      AND to_tsvector('simple', m.content) @@ plainto_tsquery('simple', ${word})
    GROUP BY s.user_id, u.public_id
    ORDER BY chats DESC
  `);
}

/** A word that shows up in chats of at least two different users. */
async function sharedWord(): Promise<string | null> {
  const [row] = await db.$queryRaw<{ word: string }[]>(Prisma.sql`
    SELECT w.word
    FROM (
      SELECT DISTINCT s.user_id, lower(t.word) AS word
      FROM chat_messages m
      JOIN chat_sessions s ON s.id = m.session_id
      CROSS JOIN LATERAL regexp_split_to_table(m.content, '[^A-Za-z]+') AS t(word)
      WHERE s.is_locked = false AND m.status IN ('completed', 'aborted') AND length(t.word) >= 6
    ) w
    GROUP BY w.word
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `);
  return row?.word ?? null;
}

async function main() {
  await ensureIndex();

  let word = (process.argv[2] ?? "kucing").toLowerCase();
  let owners = await ownersOf(word);
  if (owners.length < 2) {
    const fallback = await sharedWord();
    console.log(`"${word}" appears in chats of ${owners.length} user(s); using "${fallback}" instead`);
    if (!fallback) throw new Error("no word shared by two users: cannot test isolation");
    word = fallback;
    owners = await ownersOf(word);
  }
  assert.ok(owners.length >= 2, "need at least two users with matching chats");
  console.log(`"${word}" appears in chats of ${owners.length} users`);

  // Every user that has the word runs the real tool; each result must be their own chat
  for (const owner of owners) {
    const result = await searchPastChatsTool.execute(
      { query: word, limit: 8 },
      { userId: owner.publicId, sessionId: "none", userInternalId: owner.userId }
    );
    assert.ok(result.success, result.error?.message);
    const chatIds = result.data!.chats.map((c) => c.chatId);
    assert.ok(chatIds.length > 0, `user ${owner.userId} found none of their own chats`);

    const rows = await db.chatSession.findMany({
      where: { publicId: { in: chatIds } },
      select: { publicId: true, userId: true },
    });
    const foreign = rows.filter((r) => r.userId !== owner.userId);
    assert.equal(foreign.length, 0, `user ${owner.userId} got chats of other users: ${foreign.map((f) => f.publicId)}`);
    console.log(`user ${owner.userId}: ${chatIds.length} chat(s) returned, all their own`);
  }

  // A user who never wrote the word gets nothing, even though others did
  const ownerIds = owners.map((o) => o.userId);
  const outsider = await db.user.findFirst({
    where: { id: { notIn: ownerIds } },
    select: { id: true, publicId: true },
  });
  if (outsider) {
    const result = await searchPastChatsTool.execute(
      { query: word },
      { userId: outsider.publicId, sessionId: "none", userInternalId: outsider.id }
    );
    assert.ok(result.success, result.error?.message);
    assert.equal(result.data!.chats.length, 0, "user without matches saw other users' chats");
    console.log(`user ${outsider.id} (never wrote "${word}"): 0 chats returned`);
  }

  console.log("\nPASS: search_past_chats only returns the caller's own chats");
}

main()
  .catch((err) => {
    console.error("FAIL:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
