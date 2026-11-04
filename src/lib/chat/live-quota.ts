import { db } from "@/lib/db";
import { redis } from "@/lib/redis/client";
import { windowStartsAt } from "./quota-windows";

/**
 * Running spend of one user, kept in Redis (`quota:live:<userId>`) so a reply is
 * charged while it streams instead of after it is stored. Postgres stays the
 * durable ledger (written once at turn end); this key is only (re)built from it
 * when missing: first request after a deploy, a Redis restart, or an admin reset.
 *
 * Buckets carry their window start, so a new month / week / five-hour window /
 * day starts at zero without any cleanup job.
 */
export interface LiveLedger {
  month: { start: number; usd: number; requests: number };
  week: { start: number; usd: number };
  fiveHour: { start: number; usd: number };
  day: { start: number; requests: number };
  /** Start times (ms) of requests in the last minute, for the RPM limit */
  recent: number[];
}

const liveKey = (userId: bigint) => `quota:live:${userId}`;
const LIVE_TTL_SECONDS = 40 * 86_400;

/**
 * Applies a charge atomically: rolls buckets whose window ended, adds the cost
 * and request deltas, and returns the updated ledger (nil when never seeded).
 */
const CHARGE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local s = cjson.decode(raw)
local now = tonumber(ARGV[1])
local usd = tonumber(ARGV[2])
local requests = tonumber(ARGV[3])
local function roll(b, start, fields)
  if b.start ~= start then
    b.start = start
    for _, f in ipairs(fields) do b[f] = 0 end
  end
end
roll(s.month, tonumber(ARGV[4]), {'usd', 'requests'})
roll(s.week, tonumber(ARGV[5]), {'usd'})
roll(s.fiveHour, tonumber(ARGV[6]), {'usd'})
roll(s.day, tonumber(ARGV[7]), {'requests'})
s.month.usd = s.month.usd + usd
s.week.usd = s.week.usd + usd
s.fiveHour.usd = s.fiveHour.usd + usd
s.month.requests = s.month.requests + requests
s.day.requests = s.day.requests + requests
local recent = {}
for _, t in ipairs(s.recent) do
  if t > now - 60000 then recent[#recent + 1] = t end
end
if requests > 0 then recent[#recent + 1] = now end
s.recent = recent
local out = cjson.encode(s)
redis.call('SET', KEYS[1], out, 'EX', ARGV[8])
return out
`;

async function seedFromDatabase(userId: bigint, now: Date): Promise<LiveLedger> {
  const starts = windowStartsAt(now);
  const [monthly, weekly, fiveHour, dayRequests, recent] = await Promise.all([
    db.userUsagePeriod.findUnique({
      where: { userId_periodStart: { userId, periodStart: starts.month } },
      select: { costUsd: true, requestCount: true },
    }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "weekly", windowKey: starts.week.toISOString() } },
      select: { costUsd: true },
    }),
    db.userUsageWindow.findUnique({
      where: { userId_windowType_windowKey: { userId, windowType: "five_hour", windowKey: starts.fiveHour.toISOString() } },
      select: { costUsd: true },
    }),
    db.usageLog.count({ where: { userId, createdAt: { gte: starts.day } } }),
    db.usageLog.findMany({
      where: { userId, createdAt: { gte: new Date(now.getTime() - 60_000) } },
      select: { createdAt: true },
    }),
  ]);

  return {
    month: { start: starts.month.getTime(), usd: Number(monthly?.costUsd ?? 0), requests: monthly?.requestCount ?? 0 },
    week: { start: starts.week.getTime(), usd: Number(weekly?.costUsd ?? 0) },
    fiveHour: { start: starts.fiveHour.getTime(), usd: Number(fiveHour?.costUsd ?? 0) },
    day: { start: starts.day.getTime(), requests: dayRequests },
    recent: recent.map((r) => r.createdAt.getTime()),
  };
}

/** Parses a stored ledger; Redis Lua cjson writes an empty array as `{}`. */
function parseLedger(raw: string): LiveLedger {
  const ledger = JSON.parse(raw) as LiveLedger;
  if (!Array.isArray(ledger.recent)) ledger.recent = [];
  return ledger;
}

/** Ledger as seen at `now`: buckets of an ended window read as zero. */
export function ledgerAt(ledger: LiveLedger, now: Date): LiveLedger {
  const starts = windowStartsAt(now);
  const cutoff = now.getTime() - 60_000;
  return {
    month:
      ledger.month.start === starts.month.getTime()
        ? ledger.month
        : { start: starts.month.getTime(), usd: 0, requests: 0 },
    week: ledger.week.start === starts.week.getTime() ? ledger.week : { start: starts.week.getTime(), usd: 0 },
    fiveHour:
      ledger.fiveHour.start === starts.fiveHour.getTime()
        ? ledger.fiveHour
        : { start: starts.fiveHour.getTime(), usd: 0 },
    day: ledger.day.start === starts.day.getTime() ? ledger.day : { start: starts.day.getTime(), requests: 0 },
    recent: ledger.recent.filter((t) => t > cutoff),
  };
}

/**
 * Current ledger of the user: one Redis GET when warm, a Postgres seed only when
 * the key is missing. Null when Redis is not configured (callers use Postgres).
 */
export async function readLiveLedger(userId: bigint, now = new Date()): Promise<LiveLedger | null> {
  if (!redis) return null;
  const key = liveKey(userId);
  try {
    const raw = await redis.get(key);
    if (raw) return ledgerAt(parseLedger(raw), now);

    const seeded = await seedFromDatabase(userId, now);
    // NX: a concurrent request may have seeded (and charged) it meanwhile; keep theirs
    const created = await redis.set(key, JSON.stringify(seeded), "EX", LIVE_TTL_SECONDS, "NX");
    if (created) return seeded;
    const winner = await redis.get(key);
    return winner ? ledgerAt(parseLedger(winner), now) : seeded;
  } catch (err) {
    console.warn("[LIVE_QUOTA_READ_ERROR]", err);
    return null;
  }
}

/**
 * Adds spend (and request count) to the live ledger. `usd` may be negative to
 * correct an earlier estimate. Returns the updated ledger, or null when the
 * ledger is not seeded / Redis is down (the next read reseeds from Postgres).
 */
export async function chargeLiveLedger(
  userId: bigint,
  usd: number,
  requests: number,
  now = new Date()
): Promise<LiveLedger | null> {
  if (!redis || (usd === 0 && requests === 0)) return null;
  const starts = windowStartsAt(now);
  try {
    const raw = (await redis.eval(
      CHARGE_SCRIPT,
      1,
      liveKey(userId),
      String(now.getTime()),
      usd.toFixed(10),
      String(requests),
      String(starts.month.getTime()),
      String(starts.week.getTime()),
      String(starts.fiveHour.getTime()),
      String(starts.day.getTime()),
      String(LIVE_TTL_SECONDS)
    )) as string | null;
    return raw ? parseLedger(raw) : null;
  } catch (err) {
    console.warn("[LIVE_QUOTA_CHARGE_ERROR]", err);
    return null;
  }
}

/** Drops the ledger so the next read rebuilds it from Postgres (admin reset, plan purchase). */
export async function resetLiveLedger(userId: bigint | string): Promise<void> {
  if (!redis) return;
  await redis.del(`quota:live:${userId}`).catch(() => {});
}
