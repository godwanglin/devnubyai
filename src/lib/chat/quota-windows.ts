/** Spend windows shared by the Postgres usage tables and the Redis live ledger (all UTC). */

export const FIVE_HOURS_MS = 18_000_000;
export const WEEK_MS = 7 * 86_400_000;
export const DAY_MS = 86_400_000;

export function getCurrentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function getNextPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function getUtcWeekStart(now: Date): Date {
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function getFiveHourStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / FIVE_HOURS_MS) * FIVE_HOURS_MS);
}

export function getUtcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface WindowStarts {
  month: Date;
  week: Date;
  fiveHour: Date;
  day: Date;
}

export function windowStartsAt(now: Date): WindowStarts {
  return {
    month: getCurrentPeriodStart(now),
    week: getUtcWeekStart(now),
    fiveHour: getFiveHourStart(now),
    day: getUtcDayStart(now),
  };
}

export function windowResetsAt(now: Date) {
  const starts = windowStartsAt(now);
  return {
    monthly: getNextPeriodStart(now),
    weekly: new Date(starts.week.getTime() + WEEK_MS),
    fiveHour: new Date(starts.fiveHour.getTime() + FIVE_HOURS_MS),
    daily: new Date(starts.day.getTime() + DAY_MS),
  };
}
