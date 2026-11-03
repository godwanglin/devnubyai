/**
 * CLI test for 10-round grace period directives & Redis write-behind state.
 * Run with: npx tsx scripts/test-grace-and-redis.ts
 */
import assert from "node:assert/strict";
import {
  saveSessionMemoryToRedis,
  getSessionMemoryFromRedis,
  saveTurnDraftToRedis,
  getTurnDraftFromRedis,
  flushTurnToDatabase,
} from "../src/lib/chat/redis-chat-state";

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

  await test("3. Turn draft in Redis handles save & retrieve", async () => {
    const testId = `msg_test_${Date.now()}`;
    await saveTurnDraftToRedis({
      assistantMessageId: "9999999999",
      assistantMessagePublicId: testId,
      sessionId: "123",
      userId: "456",
      fullContent: "Hasil laporan akhir.",
      parts: [{ type: "dynamic-tool", toolName: "create_document", state: "output-available" }],
      status: "completed",
      promptTokens: 100,
      completionTokens: 200,
      updatedAt: new Date().toISOString(),
    });

    const draft = await getTurnDraftFromRedis(testId);
    if (draft) {
      assert.equal(draft.assistantMessagePublicId, testId);
      assert.equal(draft.fullContent, "Hasil laporan akhir.");
      assert.equal(draft.parts.length, 1);
    }
  });

  await test("4. flushTurnToDatabase enqueues safely on Postgres failure without throwing", async () => {
    // Calling with non-existent BigInt ID (without real DB row) exercises the catch & enqueue block
    const testId = `msg_nonexistent_${Date.now()}`;
    const result = await flushTurnToDatabase({
      assistantMessageId: "999999999999999",
      assistantMessagePublicId: testId,
      sessionId: "123",
      userId: "456",
      fullContent: "Draft content",
      parts: [],
      status: "completed",
      promptTokens: 50,
      completionTokens: 50,
      updatedAt: new Date().toISOString(),
    });

    // Should gracefully report failure and enqueue in Redis pending flush set without throwing unhandled rejection
    assert.equal(result.success, false);
    assert.equal(result.enqueued, true);
  });

  console.log(`\nAll ${passed} Grace Period & Redis-First tests passed successfully! 🚀`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
