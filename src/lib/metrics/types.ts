export type MetricsTimeRange = "24h" | "7d" | "30d" | "all";

export type MetricsActiveTab = "overview" | "ai" | "performance" | "business";

export interface MetricsSummary {
  totalRequests: number;
  requestsTrendPct: number;
  successRatePct: number;
  totalTokens: number;
  tokensTrendPct: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  avgTtftMs: number;
  p95LatencyMs: number;
  activeUsers: number;
  totalSessions: number;
  totalRevenueIdr: number;
  totalPaidTransactions: number;
  fallbackCount: number;
  errorCount: number;
  fallbackRatePct: number;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  label: string;
  totalRequests: number;
  successfulRequests: number;
  fallbackRequests: number;
  failedRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  avgTtftMs: number;
}

export interface ModelUsageMetric {
  modelId: string;
  modelName: string;
  publicId?: string;
  requestCount: number;
  requestSharePct: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  successRatePct: number;
}

export interface GatewayMetric {
  gatewayId: string;
  name: string;
  slug: string;
  isPrimary: boolean;
  requestCount: number;
  sharePct: number;
  successCount: number;
  fallbackCount: number;
  errorCount: number;
  successRatePct: number;
  avgLatencyMs: number;
}

export interface ErrorDistributionMetric {
  errorClass: string;
  count: number;
  percentage: number;
}

export interface PlanDistributionMetric {
  planId: string;
  planName: string;
  slug: string;
  userCount: number;
  percentage: number;
  priceMonthly: number;
}

export interface RevenueDataPoint {
  date: string;
  label: string;
  revenueIdr: number;
  transactionCount: number;
}

export interface AdminMetricsData {
  timeRange: MetricsTimeRange;
  generatedAt: string;
  summary: MetricsSummary;
  timeSeries: TimeSeriesDataPoint[];
  modelUsage: ModelUsageMetric[];
  gatewayMetrics: GatewayMetric[];
  errorDistribution: ErrorDistributionMetric[];
  planDistribution: PlanDistributionMetric[];
  revenueSeries: RevenueDataPoint[];
}
