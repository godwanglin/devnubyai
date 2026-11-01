import { PrismaClient } from "@/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Bump when the Prisma schema changes so dev HMR swaps in a client with the new models
const PRISMA_SCHEMA_VERSION = "20261101_user_management";

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

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
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

// Replace the cached singleton on HMR when the schema version changes. No `instanceof`
// check: each route bundle can load its own copy of the client class, so it would fail
// across bundles and one route would close the pool another route is still using
// ("pool is closed"). The stale pool is closed later so in-flight queries can finish.
if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion !== PRISMA_SCHEMA_VERSION) {
  const stale = globalForPrisma.prisma;
  const stalePool = globalForPrisma.pgPool;
  globalForPrisma.prisma = undefined;
  globalForPrisma.pgPool = undefined;
  setTimeout(() => {
    stale.$disconnect().catch(() => {});
    stalePool?.end().catch(() => {});
  }, 60_000).unref?.();
}

export const db: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaSchemaVersion = PRISMA_SCHEMA_VERSION;
}

export default db;
