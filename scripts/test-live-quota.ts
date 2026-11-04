/**
 * Checks the live quota Lua script against a real Redis, on a throwaway key of a
 * user id that does not exist (deleted at the end).
 * Run with: npx tsx scripts/test-live-quota.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { redis } from "../src/lib/redis/client";
import { chargeLiveLedger, ledgerAt, type LiveLedger } from "../src/lib/chat/live-quota";
import { windowStartsAt } from "../src/lib/chat/quota-windows";

const FAKE_USER = 999_999_999_999n;
const key = `quota:live:${FAKE_USER}`;

async function main() {
  if (!redis) throw new Error("REDIS_URL is not set");
  const now = new Date();
  const starts = windowStartsAt(now);
  const seed: LiveLedger = {
    month: { start: starts.month.getTime(), usd: 1.5, requests: 4 },
    week: { start: starts.week.getTime(), usd: 0.5 },
    // A bucket of an older five-hour window must roll to zero on the next charge
    fiveHour: { start: starts.fiveHour.getTime() - 18_000_000, usd: 9 },
    day: { start: starts.day.getTime(), requests: 2 },
    recent: [],
  };

  try {
    // Not seeded → no-op (never creates a ledger without the Postgres baseline)
    assert.equal(await chargeLiveLedger(FAKE_USER, 0.25, 0, now), null);
    assert.equal(await redis.exists(key), 0);

    await redis.set(key, JSON.stringify(seed), "EX", 60);

    const afterEstimate = await chargeLiveLedger(FAKE_USER, 0.25, 0, now);
    assert.ok(afterEstimate);
    assert.equal(afterEstimate.month.usd, 1.75);
    assert.equal(afterEstimate.week.usd, 0.75);
    assert.equal(afterEstimate.fiveHour.usd, 0.25, "old five-hour bucket rolled over");
    assert.equal(afterEstimate.month.requests, 4, "estimates add spend, not requests");

    // Final settlement: correction down + one request
    const settled = await chargeLiveLedger(FAKE_USER, -0.05, 1, now);
    assert.ok(settled);
    assert.ok(Math.abs(settled.month.usd - 1.7) < 1e-9);
    assert.equal(settled.month.requests, 5);
    assert.equal(settled.day.requests, 3);
    assert.equal(ledgerAt(settled, now).recent.length, 1);

    console.log("✓ live quota Lua script: seed guard, rollover, estimate, settlement");
  } finally {
    await redis.del(key);
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
