import { db } from "../src/lib/db";
import { redis } from "../src/lib/redis/client";
import { generateSessionToken, hashSessionToken } from "../src/lib/auth/session";

interface BenchmarkResult {
  endpoint: string;
  name: string;
  description: string;
  iterations: number;
  successRate: number;
  minMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  rawLatencies: number[];
}

interface BenchmarkSuiteResult {
  timestamp: string;
  environment: string;
  sampleSize: number;
  warmupRuns: number;
  results: BenchmarkResult[];
}

interface TargetConfig {
  name: string;
  desc: string;
  url: string;
  headers: Record<string, string>;
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function flushAllCacheKeys(): Promise<void> {
  if (!redis) return;
  try {
    const keys = await redis.keys("cache:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    console.warn("[BENCH_REDIS_FLUSH_WARN]", err);
  }
}

async function runBenchmarkForEndpoint(
  target: TargetConfig,
  isBeforeMode: boolean,
  iterations = 50,
  warmups = 5
): Promise<BenchmarkResult> {
  const { name, desc, url, headers } = target;

  if (isBeforeMode) {
    // Before mode: flush cache before every warmup so nothing is cached
    await flushAllCacheKeys();
  } else {
    // After mode: warm up so Redis has populated data
    for (let i = 0; i < warmups; i++) {
      try {
        await fetch(url, { headers });
      } catch {
        // ignore
      }
    }
  }

  const latencies: number[] = [];
  let successes = 0;

  for (let i = 0; i < iterations; i++) {
    if (isBeforeMode) {
      // Invalidate before every single iteration to ensure pure DB hit
      await flushAllCacheKeys();
    }

    const start = performance.now();
    try {
      const res = await fetch(url, { headers });
      const end = performance.now();
      await res.text();
      if (res.ok) {
        successes++;
      }
      latencies.push(end - start);
    } catch {
      const end = performance.now();
      latencies.push(end - start);
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const minMs = Math.round(sorted[0] * 100) / 100;
  const maxMs = Math.round(sorted[sorted.length - 1] * 100) / 100;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const meanMs = Math.round((sum / sorted.length) * 100) / 100;
  const medianMs = Math.round(calculatePercentile(sorted, 50) * 100) / 100;
  const p95Ms = Math.round(calculatePercentile(sorted, 95) * 100) / 100;
  const p99Ms = Math.round(calculatePercentile(sorted, 99) * 100) / 100;
  const successRate = Math.round((successes / iterations) * 100);

  return {
    endpoint: url.replace(/^http:\/\/localhost:\d+/, ""),
    name,
    description: desc,
    iterations,
    successRate,
    minMs,
    meanMs,
    medianMs,
    p95Ms,
    p99Ms,
    maxMs,
    rawLatencies: latencies.map((v) => Math.round(v * 100) / 100),
  };
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

async function runSuite(mode: "before" | "after", targets: TargetConfig[], iterations: number, warmups: number): Promise<BenchmarkSuiteResult> {
  console.log(`\n======================================================`);
  console.log(`🚀 Running ${mode.toUpperCase()}-CACHE Suite (50 iterations)`);
  console.log(`Mode: ${mode === "before" ? "Cold Cache (100% Database)" : "Warm Cache (100% Redis)"}`);
  console.log(`======================================================\n`);

  const results: BenchmarkResult[] = [];
  for (const target of targets) {
    process.stdout.write(`Testing [${target.name}]... `);
    const res = await runBenchmarkForEndpoint(target, mode === "before", iterations, warmups);
    results.push(res);
    console.log(`✅ p50: ${res.medianMs}ms | Mean: ${res.meanMs}ms | p95: ${res.p95Ms}ms`);
  }

  return {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    sampleSize: iterations,
    warmupRuns: warmups,
    results,
  };
}

async function main() {
  const isBeforeOnly = process.argv.includes("--before");
  const isAfterOnly = process.argv.includes("--after");
  const runBoth = !isBeforeOnly && !isAfterOnly;

  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const iterations = 50;
  const warmups = 5;

  const adminRawToken = generateSessionToken();
  const userRawToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000);

  const { adminUser, regularUser } = await withRetry(async () => {
    const admin = await db.user.findFirst({ where: { role: "admin" } });
    const regular = await db.user.findFirst({ where: { role: "user" } });
    return { adminUser: admin, regularUser: regular };
  });

  if (!adminUser || !regularUser) {
    throw new Error("Missing admin or regular user in database for benchmarking");
  }

  const sessionAdmin = await withRetry(() =>
    db.authSession.create({
      data: {
        userId: adminUser.id,
        tokenHash: hashSessionToken(adminRawToken),
        expiresAt,
        ipAddress: "127.0.0.1",
        userAgent: "DevNubyBenchmark/1.0",
      },
    })
  );

  const sessionUser = await withRetry(() =>
    db.authSession.create({
      data: {
        userId: regularUser.id,
        tokenHash: hashSessionToken(userRawToken),
        expiresAt,
        ipAddress: "127.0.0.1",
        userAgent: "DevNubyBenchmark/1.0",
      },
    })
  );

  const sharedChat = await withRetry(() =>
    db.chatSession.findFirst({
      where: { shareToken: { not: null } },
      select: { shareToken: true },
    })
  );
  const shareToken = sharedChat?.shareToken || "01a1883d-a4a7-7b41-a391-54bc2684b2d4";

  const targets: TargetConfig[] = [
    {
      name: "Plans & Pricing",
      desc: "Daftar paket langganan aktif",
      url: `${baseUrl}/api/v1/plans`,
      headers: {},
    },
    {
      name: "Payment Methods",
      desc: "Metode pembayaran aktif (DOKU VA, QRIS)",
      url: `${baseUrl}/api/v1/payments/methods`,
      headers: {},
    },
    {
      name: "Public Shared Chat",
      desc: "Snapshot obrolan publik yang diakses via token",
      url: `${baseUrl}/api/v1/share/${shareToken}`,
      headers: {},
    },
    {
      name: "Rate Limiting & Quota",
      desc: "Perhitungan jendela token dan batasan laju request",
      url: `${baseUrl}/api/v1/me/quota`,
      headers: { cookie: `devnuby_session=${userRawToken}` },
    },
    {
      name: "System Prompts / Personas",
      desc: "Daftar system prompt dan persona AI (Admin)",
      url: `${baseUrl}/api/v1/admin/system-prompts`,
      headers: { cookie: `devnuby_session=${adminRawToken}` },
    },
    {
      name: "User Profile Metadata",
      desc: "Metadata profil ringkas pengguna dan status akun",
      url: `${baseUrl}/api/v1/me`,
      headers: { cookie: `devnuby_session=${userRawToken}` },
    },
    {
      name: "Active Login Sessions",
      desc: "Daftar sesi login aktif pengguna",
      url: `${baseUrl}/api/v1/user/sessions`,
      headers: { cookie: `devnuby_session=${userRawToken}` },
    },
  ];

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const benchDir = path.resolve(process.cwd(), ".bench");
  await fs.mkdir(benchDir, { recursive: true });

  try {
    if (runBoth || isBeforeOnly) {
      const beforeSuite = await runSuite("before", targets, iterations, warmups);
      await fs.writeFile(path.join(benchDir, "before-cache.json"), JSON.stringify(beforeSuite, null, 2), "utf8");
    }

    if (runBoth || isAfterOnly) {
      const afterSuite = await runSuite("after", targets, iterations, warmups);
      await fs.writeFile(path.join(benchDir, "after-cache.json"), JSON.stringify(afterSuite, null, 2), "utf8");
    }

    await generateMarkdownReport(benchDir);
  } finally {
    await db.authSession.deleteMany({
      where: { id: { in: [sessionAdmin.id, sessionUser.id] } },
    });
  }
}

async function generateMarkdownReport(benchDir: string) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  let beforeData: BenchmarkSuiteResult | null = null;
  let afterData: BenchmarkSuiteResult | null = null;

  try {
    const raw = await fs.readFile(path.join(benchDir, "before-cache.json"), "utf8");
    beforeData = JSON.parse(raw);
  } catch {}

  try {
    const raw = await fs.readFile(path.join(benchDir, "after-cache.json"), "utf8");
    afterData = JSON.parse(raw);
  } catch {}

  let md = `# 📊 Laporan Lengkap Benchmark Latensi Redis Caching DevNuby AI\n\n`;
  md += `**Waktu Pengujian:** ${new Date().toLocaleString("id-ID")}\n`;
  md += `**Metodologi:**\n`;
  md += `- **Sebelum Cache:** Redis di-invalidate/flush sebelum setiap iterasi sehingga 100% request membebani PostgreSQL database.\n`;
  md += `- **Sesudah Cache:** Redis di-warmup terlebih dahulu sehingga 100% request dilayani langsung dari Redis in-memory cache.\n`;
  md += `- **Ukuran Sampel:** 50 iterasi per endpoint (+ 5 warm-up)\n\n`;

  md += `## 1. Tabel Perbandingan Latensi & Peningkatan Kecepatan (*Speedup*)\n\n`;
  md += `| No | Endpoint & Fitur | Sebelum (p50) | Sebelum (Mean) | Sebelum (p95) | Sesudah (p50) | Sesudah (Mean) | Sesudah (p95) | Peningkatan (*Speedup* Mean) | Peningkatan (*Speedup* p95) |\n`;
  md += `|:--:|:-----------------|:-------------:|:--------------:|:-------------:|:-------------:|:--------------:|:-------------:|:----------------------------:|:---------------------------:|\n`;

  if (beforeData && afterData) {
    beforeData.results.forEach((b, idx) => {
      const a = afterData!.results.find((r) => r.endpoint === b.endpoint);
      if (!a) return;

      const speedupMean = Math.round((b.meanMs / Math.max(a.meanMs, 1)) * 10) / 10;
      const speedupP95 = Math.round((b.p95Ms / Math.max(a.p95Ms, 1)) * 10) / 10;
      const pctMean = Math.round(((b.meanMs - a.meanMs) / b.meanMs) * 100);

      md += `| ${idx + 1} | **${b.name}**<br>\`${b.endpoint}\` | ${b.medianMs} ms | **${b.meanMs} ms** | ${b.p95Ms} ms | ${a.medianMs} ms | **${a.meanMs} ms** | ${a.p95Ms} ms | **${speedupMean}x** (${pctMean}% lebih cepat) | **${speedupP95}x** |\n`;
    });
  }

  md += `\n## 2. Rincian Metrik Lengkap: Sebelum Cache (100% Database)\n\n`;
  md += `| Endpoint | Min | p50 (Median) | Mean (Rata-rata) | p95 | p99 | Max | Success Rate |\n`;
  md += `|:---------|:---:|:------------:|:----------------:|:---:|:---:|:---:|:------------:|\n`;
  if (beforeData) {
    for (const r of beforeData.results) {
      md += `| \`${r.endpoint}\` | ${r.minMs} ms | ${r.medianMs} ms | **${r.meanMs} ms** | ${r.p95Ms} ms | ${r.p99Ms} ms | ${r.maxMs} ms | ${r.successRate}% |\n`;
    }
  }

  md += `\n## 3. Rincian Metrik Lengkap: Sesudah Cache (100% Redis In-Memory)\n\n`;
  md += `| Endpoint | Min | p50 (Median) | Mean (Rata-rata) | p95 | p99 | Max | Success Rate |\n`;
  md += `|:---------|:---:|:------------:|:----------------:|:---:|:---:|:---:|:------------:|\n`;
  if (afterData) {
    for (const r of afterData.results) {
      md += `| \`${r.endpoint}\` | ${r.minMs} ms | ${r.medianMs} ms | **${r.meanMs} ms** | ${r.p95Ms} ms | ${r.p99Ms} ms | ${r.maxMs} ms | ${r.successRate}% |\n`;
    }
  }

  const reportPath = path.join(benchDir, "benchmark-report.md");
  await fs.writeFile(reportPath, md, "utf8");
  console.log(`\n📄 Generated comprehensive report at: ${reportPath}\n`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
