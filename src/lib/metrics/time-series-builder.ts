import type { ParsedRoutingRecord } from "./log-loader";
import type { MetricsTimeRange, TimeSeriesDataPoint } from "./types";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function getDateBoundaries(range: MetricsTimeRange, latestDataTime: Date) {
  const refTime = latestDataTime.getTime();
  let startMs = 0;
  let prevStartMs = 0;
  let prevEndMs = 0;

  if (range === "24h") {
    const duration = 24 * 60 * 60 * 1000;
    startMs = refTime - duration;
    prevStartMs = startMs - duration;
    prevEndMs = startMs;
  } else if (range === "7d") {
    const duration = 7 * 24 * 60 * 60 * 1000;
    startMs = refTime - duration;
    prevStartMs = startMs - duration;
    prevEndMs = startMs;
  } else if (range === "30d") {
    const duration = 30 * 24 * 60 * 60 * 1000;
    startMs = refTime - duration;
    prevStartMs = startMs - duration;
    prevEndMs = startMs;
  } else {
    // "all"
    startMs = 0;
    prevStartMs = 0;
    prevEndMs = 0;
  }

  return {
    startTime: new Date(startMs),
    prevStartTime: new Date(prevStartMs),
    prevEndTime: new Date(prevEndMs),
  };
}

export function buildTimeSeriesBuckets(
  records: ParsedRoutingRecord[],
  range: MetricsTimeRange,
  startTime: Date,
  endTime: Date
): TimeSeriesDataPoint[] {
  const buckets: { [key: string]: TimeSeriesDataPoint } = {};
  const isHourly = range === "24h";

  if (isHourly) {
    const startHour = new Date(startTime);
    startHour.setMinutes(0, 0, 0);

    for (let i = 0; i < 24; i++) {
      const d = new Date(startHour.getTime() + i * 3600 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:00`;
      const label = `${String(d.getHours()).padStart(2, "0")}:00`;
      buckets[key] = {
        timestamp: d.toISOString(),
        label,
        totalRequests: 0,
        successfulRequests: 0,
        fallbackRequests: 0,
        failedRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
        avgTtftMs: 0,
      };
    }
  } else {
    const daysCount = range === "7d" ? 7 : range === "30d" ? 30 : 14;
    const startDay = new Date(endTime.getTime() - (daysCount - 1) * 24 * 3600 * 1000);
    startDay.setHours(0, 0, 0, 0);

    for (let i = 0; i < daysCount; i++) {
      const d = new Date(startDay.getTime() + i * 24 * 3600 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const label = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
      buckets[key] = {
        timestamp: d.toISOString(),
        label,
        totalRequests: 0,
        successfulRequests: 0,
        fallbackRequests: 0,
        failedRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
        avgTtftMs: 0,
      };
    }
  }

  const latencySums: { [key: string]: { sum: number; count: number; ttftSum: number; ttftCount: number } } = {};

  for (const r of records) {
    const key = isHourly
      ? `${r.timestamp.getFullYear()}-${String(r.timestamp.getMonth() + 1).padStart(2, "0")}-${String(
          r.timestamp.getDate()
        ).padStart(2, "0")}T${String(r.timestamp.getHours()).padStart(2, "0")}:00`
      : `${r.timestamp.getFullYear()}-${String(r.timestamp.getMonth() + 1).padStart(2, "0")}-${String(
          r.timestamp.getDate()
        ).padStart(2, "0")}`;

    if (!buckets[key]) {
      const label = isHourly
        ? `${String(r.timestamp.getHours()).padStart(2, "0")}:00`
        : `${r.timestamp.getDate()} ${MONTH_NAMES[r.timestamp.getMonth()]}`;
      buckets[key] = {
        timestamp: r.timestamp.toISOString(),
        label,
        totalRequests: 0,
        successfulRequests: 0,
        fallbackRequests: 0,
        failedRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
        avgTtftMs: 0,
      };
    }

    const b = buckets[key];
    b.totalRequests += 1;
    if (r.outcome === "success") b.successfulRequests += 1;
    else if (r.outcome === "fallback") b.fallbackRequests += 1;
    else b.failedRequests += 1;

    b.promptTokens += r.promptTokens;
    b.completionTokens += r.completionTokens;
    b.totalTokens += r.promptTokens + r.completionTokens;

    if (!latencySums[key]) latencySums[key] = { sum: 0, count: 0, ttftSum: 0, ttftCount: 0 };
    if (r.latencyMs > 0) {
      latencySums[key].sum += r.latencyMs;
      latencySums[key].count += 1;
    }
    if (r.ttftMs && r.ttftMs > 0) {
      latencySums[key].ttftSum += r.ttftMs;
      latencySums[key].ttftCount += 1;
    }
  }

  for (const [key, b] of Object.entries(buckets)) {
    const ls = latencySums[key];
    if (ls && ls.count > 0) {
      b.avgLatencyMs = Math.round(ls.sum / ls.count);
    }
    if (ls && ls.ttftCount > 0) {
      b.avgTtftMs = Math.round(ls.ttftSum / ls.ttftCount);
    }
  }

  return Object.values(buckets).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
