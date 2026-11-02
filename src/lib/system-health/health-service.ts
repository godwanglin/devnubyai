import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { getDbPoolConfig } from "@/lib/db/pool-config";
import { redis } from "@/lib/redis/client";
import { LOG_DIR, getAvailableLogDates } from "@/lib/logger/file-logger";
import type {
  CpuHealth,
  MemoryHealth,
  PostgresHealth,
  RedisHealth,
  ServerHealthStatus,
  StorageHealth,
  SystemHealthReport,
  SystemInfo,
} from "./types";

function probeCpu(): CpuHealth {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalAll = 0;

  for (const c of cpus) {
    const t = c.times;
    totalIdle += t.idle;
    totalAll += t.user + t.nice + t.sys + t.idle + t.irq;
  }

  const busy = totalAll - totalIdle;
  const usagePct = totalAll > 0 ? Math.round((busy / totalAll) * 1000) / 10 : 0;
  const procCpu = process.cpuUsage();

  return {
    usagePct,
    cores: cpus.length,
    model: cpus[0]?.model?.trim() || "Unknown CPU",
    speedMhz: cpus[0]?.speed || 0,
    loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    processCpuUserMs: Math.round(procCpu.user / 1000),
    processCpuSysMs: Math.round(procCpu.system / 1000),
  };
}

function probeMemory(): MemoryHealth {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
  const procMem = process.memoryUsage();

  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: used,
    usedPct,
    processRssBytes: procMem.rss,
    processHeapUsedBytes: procMem.heapUsed,
    processHeapTotalBytes: procMem.heapTotal,
  };
}

async function probePostgres(): Promise<PostgresHealth> {
  const poolConfig = getDbPoolConfig();
  const t0 = performance.now();

  try {
    interface PgPingResult {
      alive: number;
      db_name: string;
      ver: string;
    }

    interface PgConnResult {
      total: number;
      active: number;
      idle: number;
    }

    interface PgSizeResult {
      size_pretty: string;
      size_bytes: string;
    }

    interface PgTableCountResult {
      tbl_count: number;
    }

    const [pingRes, connRes, sizeRes, tblRes] = await Promise.all([
      db.$queryRawUnsafe<PgPingResult[]>(
        "SELECT 1 as alive, current_database() as db_name, version() as ver"
      ),
      db.$queryRawUnsafe<PgConnResult[]>(
        "SELECT count(*)::int as total, count(*) filter (where state = 'active')::int as active, count(*) filter (where state = 'idle')::int as idle FROM pg_stat_activity WHERE datname = current_database()"
      ),
      db.$queryRawUnsafe<PgSizeResult[]>(
        "SELECT pg_size_pretty(pg_database_size(current_database())) as size_pretty, pg_database_size(current_database())::text as size_bytes"
      ),
      db.$queryRawUnsafe<PgTableCountResult[]>(
        "SELECT count(*)::int as tbl_count FROM information_schema.tables WHERE table_schema = 'public'"
      ),
    ]);

    const latencyMs = Math.round(performance.now() - t0);
    const pingRow = pingRes[0];
    const connRow = connRes[0] || { total: 0, active: 0, idle: 0 };
    const sizeRow = sizeRes[0] || { size_pretty: "0 MB", size_bytes: "0" };
    const tblRow = tblRes[0] || { tbl_count: 0 };

    const status: PostgresHealth["status"] =
      latencyMs > 1000 ? "degraded" : "connected";

    return {
      status,
      latencyMs,
      dbName: pingRow?.db_name || "devnuby_ai",
      version: pingRow?.ver?.split(" on ")[0] || "PostgreSQL 16",
      sizePretty: sizeRow.size_pretty || "Unknown",
      sizeBytes: parseInt(sizeRow.size_bytes || "0", 10),
      connections: {
        total: connRow.total,
        active: connRow.active,
        idle: connRow.idle,
        maxPool: poolConfig.max,
      },
      tablesCount: tblRow.tbl_count,
      error: null,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    return {
      status: "down",
      latencyMs,
      dbName: "devnuby_ai",
      version: "Unknown",
      sizePretty: "0 MB",
      sizeBytes: 0,
      connections: {
        total: 0,
        active: 0,
        idle: 0,
        maxPool: poolConfig.max,
      },
      tablesCount: 0,
      error: err instanceof Error ? err.message : "Gagal terhubung ke database PostgreSQL",
    };
  }
}

async function probeRedis(): Promise<RedisHealth> {
  if (!redis) {
    return {
      status: "fallback",
      mode: "in-memory",
      latencyMs: null,
      version: null,
      usedMemory: null,
      peakMemory: null,
      connectedClients: null,
      totalKeys: 0,
      opsPerSec: null,
      uptimeSeconds: null,
      error: "REDIS_URL tidak dikonfigurasi; sistem beroperasi dengan in-memory cache fallback.",
    };
  }

  const t0 = performance.now();
  try {
    const [pong, rawInfo, dbsize] = await Promise.all([
      redis.ping(),
      redis.info(),
      redis.dbsize().catch(() => 0),
    ]);

    const latencyMs = Math.round(performance.now() - t0);

    const infoMap: Record<string, string> = {};
    for (const line of rawInfo.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        infoMap[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
      }
    }

    const version = infoMap.redis_version || null;
    const usedMemory = infoMap.used_memory_human || null;
    const peakMemory = infoMap.used_memory_peak_human || null;
    const connectedClients = infoMap.connected_clients
      ? parseInt(infoMap.connected_clients, 10)
      : null;
    const opsPerSec = infoMap.instantaneous_ops_per_sec
      ? parseInt(infoMap.instantaneous_ops_per_sec, 10)
      : null;
    const uptimeSeconds = infoMap.uptime_in_seconds
      ? parseInt(infoMap.uptime_in_seconds, 10)
      : null;

    const status: RedisHealth["status"] =
      pong === "PONG" && latencyMs < 500 ? "connected" : "fallback";

    return {
      status,
      mode: "redis",
      latencyMs,
      version,
      usedMemory,
      peakMemory,
      connectedClients,
      totalKeys: dbsize || 0,
      opsPerSec,
      uptimeSeconds,
      error: null,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    return {
      status: "down",
      mode: "redis",
      latencyMs,
      version: null,
      usedMemory: null,
      peakMemory: null,
      connectedClients: null,
      totalKeys: 0,
      opsPerSec: null,
      uptimeSeconds: null,
      error: err instanceof Error ? err.message : "Gagal terhubung ke server Redis",
    };
  }
}

async function probeStorage(): Promise<StorageHealth> {
  let logDirSizeBytes = 0;
  let logFilesCount = 0;
  let availableLogDates: string[] = [];

  try {
    availableLogDates = await getAvailableLogDates();
    if (fs.existsSync(LOG_DIR)) {
      const files = await fs.promises.readdir(LOG_DIR);
      logFilesCount = files.length;
      for (const file of files) {
        const stat = await fs.promises.stat(path.join(LOG_DIR, file));
        logDirSizeBytes += stat.size;
      }
    }
  } catch {
    // Ignore FS errors
  }

  return {
    logDirSizeBytes,
    logFilesCount,
    availableLogDates,
  };
}

function probeSystem(): SystemInfo {
  return {
    nodeVersion: process.version,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    systemUptimeSeconds: Math.round(os.uptime()),
    processUptimeSeconds: Math.round(process.uptime()),
  };
}

function determineOverallStatus(
  postgres: PostgresHealth,
  redisHealth: RedisHealth,
  memory: MemoryHealth,
  cpu: CpuHealth
): ServerHealthStatus {
  if (postgres.status === "down" || memory.usedPct >= 96 || cpu.usagePct >= 98) {
    return "critical";
  }
  if (
    postgres.status === "degraded" ||
    redisHealth.status === "down" ||
    memory.usedPct >= 85 ||
    cpu.usagePct >= 85 ||
    postgres.latencyMs > 800
  ) {
    return "degraded";
  }
  return "healthy";
}

export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  const [postgres, redisHealth, storage] = await Promise.all([
    probePostgres(),
    probeRedis(),
    probeStorage(),
  ]);

  const cpu = probeCpu();
  const memory = probeMemory();
  const system = probeSystem();
  const overallStatus = determineOverallStatus(postgres, redisHealth, memory, cpu);

  return {
    overallStatus,
    timestamp: new Date().toISOString(),
    cpu,
    memory,
    postgres,
    redis: redisHealth,
    storage,
    system,
  };
}
