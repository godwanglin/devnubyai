import { PrismaClient } from "@/generated/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// Bump when the Prisma schema changes so dev HMR swaps in a client with the new models
const PRISMA_SCHEMA_VERSION = "20261030_system_prompts";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaVersion?: string;
};

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Please configure it in your environment."
    );
  }

  // Pool options only apply to an object config, so expand DATABASE_URL into one
  const url = new URL(databaseUrl);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    connectionLimit: 10,
  });

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
  globalForPrisma.prisma = undefined;
  setTimeout(() => {
    stale.$disconnect().catch(() => {});
  }, 60_000).unref?.();
}

export const db: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaSchemaVersion = PRISMA_SCHEMA_VERSION;
}

export default db;
