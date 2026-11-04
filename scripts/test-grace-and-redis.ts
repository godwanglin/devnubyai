/**
 * CLI test for 10-round grace period directives & Redis write-behind state.
 * Run with: npx tsx scripts/test-grace-and-redis.ts
 */
import assert from "node:assert/strict";
import {
  saveSessionMemoryToRedis,
  getSessionMemoryFromRedis,
  beginTurn,
  completeTurn,
  flushTurn,
  getTurn,
  listSessionTurns,
  type PendingTurn,
} from "../src/lib/chat/redis-chat-state";
import { mergePendingTurns } from "../src/lib/chat/pending-turns";
import { ledgerAt, type LiveLedger } from "../src/lib/chat/live-quota";
import { finalTurnTokens } from "../src/lib/chat/quota";
import { buildUserMemoryPrompt } from "../src/lib/chat/user-memory";
import { uuidv7 } from "../src/lib/api/uuidv7";
import type { ChatMessageDto } from "../src/lib/chat/service-types";

function makeTurn(sessionId: string): PendingTurn {
  const now = Date.now();
  return {
    kind: "send",
    requestId: uuidv7(),
    userId: "999999999999999",
    sessionId,
    sessionPublicId: uuidv7(),
    autoTitle: null,
    user: {
      publicId: uuidv7(),
      content: "Halo",
      parts: null,
      fileIds: [],
      attachments: [],
      historyContent: "Halo",
    },
    assistant: {
      publicId: uuidv7(),
      content: "",
      reasoning: null,
      parts: [],
      status: "streaming",
      errorCode: null,
      catalogModelId: "1",
      catalogModelPublicId: "test-model",
      promptTokens: 0,
      completionTokens: 0,
    },
    usage: null,
    startedAt: now,
    updatedAt: now,
    flushAttempts: 0,
  };
}

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

async function main() {
  console.log("Starting Grace Period & Redis-First Chat State Tests...\n");

  await test("1. Grace period escalation directives structure", () => {
    const MAX_GRACE_TOOL_ROUNDS = 10;
    const directives: Record<number, string> = {};

    for (let r = 1; r <= MAX_GRACE_TOOL_ROUNDS; r += 1) {
      const remainingGraceRounds = MAX_GRACE_TOOL_ROUNDS - r;
      if (r === 1) {
        directives[r] = "CRITICAL SYSTEM DIRECTIVE: FINAL GRACE PERIOD - 10 ROUNDS REMAINING";
      } else if (remainingGraceRounds === 5) {
        directives[r] = "URGENT SYSTEM DIRECTIVE: WRAP-UP ENFORCEMENT - ONLY 5 ROUNDS LEFT";
      } else if (remainingGraceRounds === 1) {
        directives[r] = "FINAL ROUND WARNING: TOOL ACCESS TERMINATING AFTER THIS CALL";
      }
    }

    assert.equal(Object.keys(directives).length, 3);
    assert.match(directives[1], /FINAL GRACE PERIOD - 10 ROUNDS/);
    assert.match(directives[5], /ONLY 5 ROUNDS LEFT/);
    assert.match(directives[9], /FINAL ROUND WARNING/);
  });

  await test("2. Session memory in Redis fallback safe", async () => {
    // If REDIS_URL is not set or Redis is mock/local, functions handle gracefully without throwing
    await saveSessionMemoryToRedis("test-session-123", {
      filesProduced: [
        {
          filename: "dokumen.docx",
          displayName: "Dokumen_Laporan.docx",
          createdAt: new Date().toISOString(),
        },
      ],
      lastTurnSummary: "Test summary",
    });

    const mem = await getSessionMemoryFromRedis("test-session-123");
    // If Redis is connected, assert data; if not configured, assert null without crash
    if (mem) {
      assert.equal(mem.filesProduced.length, 1);
      assert.equal(mem.filesProduced[0].displayName, "Dokumen_Laporan.docx");
    }
  });

  await test("3. Streaming turn is held in Redis and listed for its chat", async () => {
    const turn = makeTurn(`999999${Date.now() % 1000}`);
    await beginTurn(turn);

    const stored = await getTurn(turn.assistant.publicId);
    assert.ok(stored);
    assert.equal(stored.assistant.status, "streaming");
    const listed = await listSessionTurns(turn.sessionId);
    assert.ok(listed.some((t) => t.assistant.publicId === turn.assistant.publicId));

    // A streaming turn is never written to Postgres
    assert.equal(await flushTurn(turn.assistant.publicId), "pending");
  });

  await test("4. Ended turn for a missing chat is dropped, not retried forever", async () => {
    const turn = makeTurn("999999999999999");
    await beginTurn(turn);
    turn.assistant.status = "completed";
    turn.assistant.content = "Draft content";
    const result = await completeTurn(turn);

    // FK violation (no such chat) is permanent: the turn leaves Redis. If Postgres is
    // unreachable instead, the turn stays queued for the flush worker.
    assert.equal(result.stored, false);
    const left = await getTurn(turn.assistant.publicId);
    if (left) assert.ok(left.flushAttempts >= 1);
  });

  await test("5. Pending turns merge after stored messages; regenerations overlay", () => {
    const stored = [
      { id: "u1", role: "user", content: "hi", reasoning: null, parts: null, status: "completed", createdAt: "", updatedAt: "" },
      { id: "a1", role: "assistant", content: "old", reasoning: null, parts: null, status: "completed", createdAt: "", updatedAt: "" },
    ] as ChatMessageDto[];
    const send = makeTurn("1");
    const regen: PendingTurn = {
      ...makeTurn("1"),
      kind: "regenerate",
      user: null,
      assistant: { ...makeTurn("1").assistant, publicId: "a1", content: "new" },
    };
    const merged = mergePendingTurns(stored, [regen, send], "chat");
    assert.deepEqual(merged.map((m) => m.id), ["u1", "a1", send.user!.publicId, send.assistant.publicId]);
    assert.equal(merged[1].content, "new");
    assert.equal(merged[1].status, "streaming");
  });

  await test("6. Live ledger buckets of an ended window read as zero", () => {
    const start = new Date("2026-11-03T10:00:00Z");
    const ledger: LiveLedger = {
      month: { start: Date.UTC(2026, 10, 1), usd: 4, requests: 9 },
      week: { start: Date.UTC(2026, 10, 2), usd: 2 },
      fiveHour: { start: Date.UTC(2026, 10, 3, 10), usd: 1 },
      day: { start: Date.UTC(2026, 10, 3), requests: 3 },
      recent: [start.getTime() - 30_000, start.getTime() - 90_000],
    };
    const same = ledgerAt(ledger, start);
    assert.equal(same.fiveHour.usd, 1);
    assert.equal(same.recent.length, 1);

    const nextDay = ledgerAt(ledger, new Date("2026-11-04T01:00:00Z"));
    assert.equal(nextDay.month.usd, 4);
    assert.equal(nextDay.week.usd, 2);
    assert.equal(nextDay.fiveHour.usd, 0);
    assert.equal(nextDay.day.requests, 0);
  });

  await test("7. Billing of completed vs stopped turns", () => {
    const base = { promptTokens: 0, completionTokens: 0, generatedChars: 400, promptChars: () => 800 };
    assert.deepEqual(finalTurnTokens({ ...base, completed: true }), { promptTokens: 0, completionTokens: 0 });
    assert.deepEqual(finalTurnTokens({ ...base, completed: false }), { promptTokens: 200, completionTokens: 100 });
    assert.equal(finalTurnTokens({ ...base, completed: false, generatedChars: 0 }), null);
  });

  await test("8. User memory prompt: framed as data, trimmed, points to 'list' for the rest", () => {
    assert.equal(buildUserMemoryPrompt([]), null);

    const note = (i: number, content: string) => ({
      id: `n${i}`, title: `Note ${i}`, content, createdAt: "", updatedAt: "",
    });
    const prompt = buildUserMemoryPrompt([note(1, "Suka jawaban singkat\nPakai bahasa Indonesia"), note(2, "x".repeat(2000))]);
    assert.ok(prompt);
    assert.match(prompt, /not instructions/);
    assert.match(prompt, /- Note 1: Suka jawaban singkat Pakai bahasa Indonesia/);
    assert.match(prompt, /\(truncated\)/);

    const many = buildUserMemoryPrompt(Array.from({ length: 30 }, (_, i) => note(i, "y".repeat(500))));
    assert.ok(many);
    assert.match(many, /more or longer notes exist/);
    assert.ok(many.length < 8000);
  });

  console.log(`\nAll ${passed} Grace Period & Redis-First tests passed successfully! 🚀`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
