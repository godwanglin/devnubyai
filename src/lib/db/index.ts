import { PrismaClient } from "@/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getDbPoolConfig } from "./pool-config";

// Bump when the Prisma schema changes so dev HMR swaps in a client with the new models
const PRISMA_SCHEMA_VERSION = "20261101_pool_v2";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaVersion?: string;
  pgPool?: Pool;
};

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Please configure it in your environment."
    );
  }

  const poolConfig = getDbPoolConfig();

  const pool = new Pool({
    connectionString: databaseUrl,
    max: poolConfig.max,
    idleTimeoutMillis: poolConfig.idleTimeoutSeconds * 1000,
    connectionTimeoutMillis: poolConfig.connectionTimeoutSeconds * 1000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/**
 * Hot-swaps the DB connection pool and Prisma instance with updated pool configuration.
 */
export function reconfigureDbPool(): PrismaClient {
  const stalePrisma = globalForPrisma.prisma;

  const nextPrisma = createPrismaClient();
  globalForPrisma.prisma = nextPrisma;
  globalForPrisma.prismaSchemaVersion = PRISMA_SCHEMA_VERSION;

  if (stalePrisma) {
    setTimeout(() => {
      stalePrisma.$disconnect().catch(() => {});
    }, 30_000).unref?.();
  }

  return nextPrisma;
}

if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion !== PRISMA_SCHEMA_VERSION) {
  const stale = globalForPrisma.prisma;
  globalForPrisma.prisma = undefined;
  globalForPrisma.pgPool = undefined;
  setTimeout(() => {
    stale.$disconnect().catch(() => {});
  }, 30_000).unref?.();
}

function getActivePrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const client = createPrismaClient();
    globalForPrisma.prisma = client;
    globalForPrisma.prismaSchemaVersion = PRISMA_SCHEMA_VERSION;
    return client;
  }
  return globalForPrisma.prisma;
}

/**
 * Global dynamic proxy for Prisma Client.
 * Automatically delegates to the active singleton across runtime hot-swaps.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getActivePrisma();
    const val = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof val === "function") {
      return (val as (...args: unknown[]) => unknown).bind(client);
    }
    return val;
  },
});

export default db;
