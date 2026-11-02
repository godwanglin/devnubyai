export type ServerHealthStatus = "healthy" | "degraded" | "critical";

export interface CpuHealth {
  usagePct: number;
  cores: number;
  model: string;
  speedMhz: number;
  loadAvg: number[];
  processCpuUserMs: number;
  processCpuSysMs: number;
}

export interface MemoryHealth {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPct: number;
  processRssBytes: number;
  processHeapUsedBytes: number;
  processHeapTotalBytes: number;
}

export interface PostgresHealth {
  status: "connected" | "degraded" | "down";
  latencyMs: number;
  dbName: string;
  version: string;
  sizePretty: string;
  sizeBytes: number;
  connections: {
    total: number;
    active: number;
    idle: number;
    maxPool: number;
  };
  tablesCount: number;
  error: string | null;
}

export interface RedisHealth {
  status: "connected" | "fallback" | "down";
  mode: "redis" | "in-memory";
  latencyMs: number | null;
  version: string | null;
  usedMemory: string | null;
  peakMemory: string | null;
  connectedClients: number | null;
  totalKeys: number;
  opsPerSec: number | null;
  uptimeSeconds: number | null;
  error: string | null;
}

export interface StorageHealth {
  logDirSizeBytes: number;
  logFilesCount: number;
  availableLogDates: string[];
}

export interface SystemInfo {
  nodeVersion: string;
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  systemUptimeSeconds: number;
  processUptimeSeconds: number;
}

export interface SystemHealthReport {
  overallStatus: ServerHealthStatus;
  timestamp: string;
  cpu: CpuHealth;
  memory: MemoryHealth;
  postgres: PostgresHealth;
  redis: RedisHealth;
  storage: StorageHealth;
  system: SystemInfo;
}
