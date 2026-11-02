import { db } from "@/lib/db";
import { loadRoutingLogRecords } from "./log-loader";
import { buildTimeSeriesBuckets, getDateBoundaries } from "./time-series-builder";
import type {
  AdminMetricsData,
  ErrorDistributionMetric,
  GatewayMetric,
  MetricsSummary,
  MetricsTimeRange,
  ModelUsageMetric,
  PlanDistributionMetric,
  RevenueDataPoint,
} from "./types";

/**
 * Main service function to compute all metrics across routing logs and database.
 */
export async function getAdminMetrics(range: MetricsTimeRange = "7d"): Promise<AdminMetricsData> {
  const allRecords = await loadRoutingLogRecords();

  const latestTime =
    allRecords.length > 0 ? allRecords[allRecords.length - 1].timestamp : new Date();

  const { startTime, prevStartTime, prevEndTime } = getDateBoundaries(range, latestTime);

  // Filter current period records
  const currentRecords =
    range === "all"
      ? allRecords
      : allRecords.filter((r) => r.timestamp >= startTime && r.timestamp <= latestTime);

  // Filter previous period records for trend %
  const prevRecords =
    range === "all"
      ? []
      : allRecords.filter((r) => r.timestamp >= prevStartTime && r.timestamp < prevEndTime);

  // 1. Calculate Summary KPIs
  const totalRequests = currentRecords.length;
  const prevRequests = prevRecords.length;
  const requestsTrendPct =
    prevRequests > 0
      ? Math.round(((totalRequests - prevRequests) / prevRequests) * 1000) / 10
      : 0;

  let successCount = 0;
  let fallbackCount = 0;
  let errorCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let ttftSum = 0;
  let ttftCount = 0;
  const latencies: number[] = [];

  for (const r of currentRecords) {
    if (r.outcome === "success") successCount += 1;
    else if (r.outcome === "fallback") fallbackCount += 1;
    else errorCount += 1;

    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;

    if (r.latencyMs > 0) {
      latencySum += r.latencyMs;
      latencyCount += 1;
      latencies.push(r.latencyMs);
    }
    if (r.ttftMs && r.ttftMs > 0) {
      ttftSum += r.ttftMs;
      ttftCount += 1;
    }
  }

  const totalTokens = promptTokens + completionTokens;

  // Prev tokens for trend
  let prevTotalTokens = 0;
  for (const pr of prevRecords) {
    prevTotalTokens += pr.promptTokens + pr.completionTokens;
  }
  const tokensTrendPct =
    prevTotalTokens > 0
      ? Math.round(((totalTokens - prevTotalTokens) / prevTotalTokens) * 1000) / 10
      : 0;

  const successRatePct =
    totalRequests > 0 ? Math.round((successCount / totalRequests) * 1000) / 10 : 100;
  const fallbackRatePct =
    totalRequests > 0 ? Math.round((fallbackCount / totalRequests) * 1000) / 10 : 0;
  const avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
  const avgTtftMs = ttftCount > 0 ? Math.round(ttftSum / ttftCount) : 0;

  // p95 Latency
  latencies.sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95LatencyMs = latencies.length > 0 ? latencies[p95Index] || latencies[latencies.length - 1] : 0;

  // 2. Query Database in parallel for Users, Plans, Payments, Catalog Models, Gateways
  const [catalogModels, gateways, users, plans, paidTransactions, totalSessionsCount] =
    await Promise.all([
      db.catalogModel.findMany({
        select: { id: true, displayName: true, publicId: true },
      }),
      db.gateway.findMany({
        select: { id: true, name: true, slug: true, isPrimary: true },
      }),
      db.user.findMany({
        select: { id: true, planId: true, status: true, lastLoginAt: true },
      }),
      db.plan.findMany({
        select: { id: true, name: true, slug: true, priceMonthly: true },
      }),
      db.paymentTransaction.findMany({
        where: {
          status: { in: ["PAID", "COMPLETED", "SUCCESS"] },
        },
        select: {
          id: true,
          totalAmount: true,
          amount: true,
          paidAt: true,
          createdAt: true,
        },
      }),
      db.chatSession.count(),
    ]);

  const modelMap = new Map(catalogModels.map((m) => [String(m.id), m]));
  const gatewayMap = new Map(gateways.map((g) => [String(g.id), g]));
  const activeUsersCount = users.filter((u) => u.status === "active").length;

  let totalRevenueIdr = 0;
  for (const tx of paidTransactions) {
    totalRevenueIdr += tx.totalAmount || tx.amount || 0;
  }

  const summary: MetricsSummary = {
    totalRequests,
    requestsTrendPct,
    successRatePct,
    totalTokens,
    tokensTrendPct,
    promptTokens,
    completionTokens,
    avgLatencyMs,
    avgTtftMs,
    p95LatencyMs,
    activeUsers: activeUsersCount,
    totalSessions: totalSessionsCount,
    totalRevenueIdr,
    totalPaidTransactions: paidTransactions.length,
    fallbackCount,
    errorCount,
    fallbackRatePct,
  };

  // 3. Time Series
  const timeSeries = buildTimeSeriesBuckets(currentRecords, range, startTime, latestTime);

  // 4. Model Usage Breakdown
  const modelStatsMap: {
    [modelId: string]: {
      requests: number;
      promptTokens: number;
      completionTokens: number;
      latencySum: number;
      latencyCount: number;
      successCount: number;
    };
  } = {};

  for (const r of currentRecords) {
    const mId = r.catalogModelId || "unknown";
    if (!modelStatsMap[mId]) {
      modelStatsMap[mId] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencySum: 0,
        latencyCount: 0,
        successCount: 0,
      };
    }
    const ms = modelStatsMap[mId];
    ms.requests += 1;
    ms.promptTokens += r.promptTokens;
    ms.completionTokens += r.completionTokens;
    if (r.latencyMs > 0) {
      ms.latencySum += r.latencyMs;
      ms.latencyCount += 1;
    }
    if (r.outcome === "success") {
      ms.successCount += 1;
    }
  }

  const modelUsage: ModelUsageMetric[] = Object.entries(modelStatsMap).map(([mId, st]) => {
    const meta = modelMap.get(mId);
    const mTokens = st.promptTokens + st.completionTokens;
    return {
      modelId: mId,
      modelName: meta ? meta.displayName : `Model #${mId}`,
      publicId: meta?.publicId,
      requestCount: st.requests,
      requestSharePct:
        totalRequests > 0 ? Math.round((st.requests / totalRequests) * 1000) / 10 : 0,
      totalTokens: mTokens,
      promptTokens: st.promptTokens,
      completionTokens: st.completionTokens,
      avgLatencyMs: st.latencyCount > 0 ? Math.round(st.latencySum / st.latencyCount) : 0,
      successRatePct:
        st.requests > 0 ? Math.round((st.successCount / st.requests) * 1000) / 10 : 100,
    };
  });
  modelUsage.sort((a, b) => b.requestCount - a.requestCount);

  // 5. Gateway Health & Reliability
  const gatewayStatsMap: {
    [gwId: string]: {
      requests: number;
      successCount: number;
      fallbackCount: number;
      errorCount: number;
      latencySum: number;
      latencyCount: number;
    };
  } = {};

  for (const r of currentRecords) {
    const gwId = r.gatewayId || "unknown";
    if (!gatewayStatsMap[gwId]) {
      gatewayStatsMap[gwId] = {
        requests: 0,
        successCount: 0,
        fallbackCount: 0,
        errorCount: 0,
        latencySum: 0,
        latencyCount: 0,
      };
    }
    const gs = gatewayStatsMap[gwId];
    gs.requests += 1;
    if (r.outcome === "success") gs.successCount += 1;
    else if (r.outcome === "fallback") gs.fallbackCount += 1;
    else gs.errorCount += 1;

    if (r.latencyMs > 0) {
      gs.latencySum += r.latencyMs;
      gs.latencyCount += 1;
    }
  }

  const gatewayMetrics: GatewayMetric[] = Object.entries(gatewayStatsMap).map(([gwId, gs]) => {
    const gw = gatewayMap.get(gwId);
    return {
      gatewayId: gwId,
      name: gw ? gw.name : `Gateway #${gwId}`,
      slug: gw ? gw.slug : `gw-${gwId}`,
      isPrimary: gw?.isPrimary || false,
      requestCount: gs.requests,
      sharePct: totalRequests > 0 ? Math.round((gs.requests / totalRequests) * 1000) / 10 : 0,
      successCount: gs.successCount,
      fallbackCount: gs.fallbackCount,
      errorCount: gs.errorCount,
      successRatePct:
        gs.requests > 0 ? Math.round((gs.successCount / gs.requests) * 1000) / 10 : 100,
      avgLatencyMs: gs.latencyCount > 0 ? Math.round(gs.latencySum / gs.latencyCount) : 0,
    };
  });
  gatewayMetrics.sort((a, b) => b.requestCount - a.requestCount);

  // 6. Error Distribution
  const errorMap: { [errorClass: string]: number } = {};
  for (const r of currentRecords) {
    if (r.outcome !== "success") {
      const ec = r.errorClass || (r.outcome === "fallback" ? "fallback_triggered" : "unknown_error");
      errorMap[ec] = (errorMap[ec] || 0) + 1;
    }
  }
  const totalFailed = fallbackCount + errorCount;
  const errorDistribution: ErrorDistributionMetric[] = Object.entries(errorMap).map(
    ([errorClass, count]) => ({
      errorClass,
      count,
      percentage: totalFailed > 0 ? Math.round((count / totalFailed) * 1000) / 10 : 0,
    })
  );
  errorDistribution.sort((a, b) => b.count - a.count);

  // 7. Plan Distribution
  const planMap = new Map(plans.map((p) => [String(p.id), p]));
  const userPlanCounts: { [planId: string]: number } = {};
  for (const u of users) {
    const pId = u.planId ? String(u.planId) : "none";
    userPlanCounts[pId] = (userPlanCounts[pId] || 0) + 1;
  }
  const totalUsers = users.length || 1;
  const planDistribution: PlanDistributionMetric[] = Object.entries(userPlanCounts).map(
    ([pId, count]) => {
      const plan = planMap.get(pId);
      return {
        planId: pId,
        planName: plan ? plan.name : "Free / No Plan",
        slug: plan ? plan.slug : "free",
        userCount: count,
        percentage: Math.round((count / totalUsers) * 1000) / 10,
        priceMonthly: plan?.priceMonthly || 0,
      };
    }
  );
  planDistribution.sort((a, b) => b.userCount - a.userCount);

  // 8. Revenue Series
  const revenueSeriesMap: { [dateKey: string]: { revenue: number; count: number } } = {};
  for (const tx of paidTransactions) {
    const txDate = tx.paidAt || tx.createdAt;
    const dateKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, "0")}-${String(
      txDate.getDate()
    ).padStart(2, "0")}`;
    if (!revenueSeriesMap[dateKey]) {
      revenueSeriesMap[dateKey] = { revenue: 0, count: 0 };
    }
    revenueSeriesMap[dateKey].revenue += tx.totalAmount || tx.amount || 0;
    revenueSeriesMap[dateKey].count += 1;
  }

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const revenueSeries: RevenueDataPoint[] = Object.entries(revenueSeriesMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, val]) => {
      const [, month, day] = dateKey.split("-");
      const label = `${day} ${monthNames[parseInt(month, 10) - 1]}`;
      return {
        date: dateKey,
        label,
        revenueIdr: val.revenue,
        transactionCount: val.count,
      };
    });

  return {
    timeRange: range,
    generatedAt: new Date().toISOString(),
    summary,
    timeSeries,
    modelUsage,
    gatewayMetrics,
    errorDistribution,
    planDistribution,
    revenueSeries,
  };
}
