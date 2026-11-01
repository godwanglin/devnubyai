import fs from "node:fs";
import path from "node:path";

export interface DbPoolConfig {
  max: number;
  connectionTimeoutSeconds: number;
  idleTimeoutSeconds: number;
}

export const DEFAULT_DB_POOL_CONFIG: DbPoolConfig = {
  max: 20,
  connectionTimeoutSeconds: 20,
  idleTimeoutSeconds: 30,
};

const CONFIG_FILE_PATH = path.resolve(process.cwd(), "config", "db-pool.json");

/**
 * Reads DB pool config synchronously on startup to configure pg-pool immediately.
 */
export function getDbPoolConfig(): DbPoolConfig {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      return {
        max: Number(parsed.max) || DEFAULT_DB_POOL_CONFIG.max,
        connectionTimeoutSeconds:
          Number(parsed.connectionTimeoutSeconds) ||
          DEFAULT_DB_POOL_CONFIG.connectionTimeoutSeconds,
        idleTimeoutSeconds:
          Number(parsed.idleTimeoutSeconds) ||
          DEFAULT_DB_POOL_CONFIG.idleTimeoutSeconds,
      };
    }
  } catch (err) {
    console.warn("[DB_POOL_CONFIG_READ_WARN]", err);
  }
  return { ...DEFAULT_DB_POOL_CONFIG };
}

/**
 * Saves DB pool config asynchronously.
 */
export async function saveDbPoolConfig(
  newConfig: Partial<DbPoolConfig>
): Promise<DbPoolConfig> {
  const current = getDbPoolConfig();
  const merged: DbPoolConfig = {
    max: Math.min(100, Math.max(5, Number(newConfig.max) || current.max)),
    connectionTimeoutSeconds: Math.min(
      60,
      Math.max(3, Number(newConfig.connectionTimeoutSeconds) || current.connectionTimeoutSeconds)
    ),
    idleTimeoutSeconds: Math.min(
      300,
      Math.max(5, Number(newConfig.idleTimeoutSeconds) || current.idleTimeoutSeconds)
    ),
  };

  const dir = path.dirname(CONFIG_FILE_PATH);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    CONFIG_FILE_PATH,
    JSON.stringify(merged, null, 2),
    "utf8"
  );

  return merged;
}
