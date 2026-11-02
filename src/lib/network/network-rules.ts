import fs from "node:fs";
import path from "node:path";

export interface NetworkRulesConfig {
  allowlist: string[];
  blocklist: string[];
}

export const DEFAULT_NETWORK_RULES: NetworkRulesConfig = {
  allowlist: [
    "127.0.0.1:3026",
    "127.0.0.1:2018",
    "localhost:3026",
    "localhost:2018",
    "aidev.weebinhub.biz.id",
    "9rt.topupin.store",
  ],
  blocklist: [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.169.254",
    "metadata.google.internal",
    "kubernetes.default",
    "194.233.78.169",
  ],
};

const CONFIG_FILE_PATH = path.resolve(process.cwd(), "config", "network-rules.json");

let cachedRules: NetworkRulesConfig = { ...DEFAULT_NETWORK_RULES };
let lastMtimeMs = 0;

function cleanEntry(entry: string): string {
  return entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function cleanEntryList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const cleaned = cleanEntry(item);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
  }
  return result;
}

/**
 * Loads network rules dynamically from config/network-rules.json.
 * Hot-reloads automatically if file mtime changed on disk (no app restart needed).
 */
export function getNetworkRules(): NetworkRulesConfig {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const stats = fs.statSync(CONFIG_FILE_PATH);
      if (stats.mtimeMs !== lastMtimeMs) {
        const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        cachedRules = {
          allowlist: cleanEntryList(parsed.allowlist ?? DEFAULT_NETWORK_RULES.allowlist),
          blocklist: cleanEntryList(parsed.blocklist ?? DEFAULT_NETWORK_RULES.blocklist),
        };
        lastMtimeMs = stats.mtimeMs;
      }
      return cachedRules;
    }
  } catch (err) {
    console.warn("[NETWORK_RULES_READ_WARN]", err);
  }
  return cachedRules;
}

/**
 * Saves network rules to config/network-rules.json atomically and updates cache.
 */
export async function saveNetworkRules(
  newRules: Partial<NetworkRulesConfig>
): Promise<NetworkRulesConfig> {
  const current = getNetworkRules();
  const merged: NetworkRulesConfig = {
    allowlist: newRules.allowlist !== undefined ? cleanEntryList(newRules.allowlist) : current.allowlist,
    blocklist: newRules.blocklist !== undefined ? cleanEntryList(newRules.blocklist) : current.blocklist,
  };

  const dir = path.dirname(CONFIG_FILE_PATH);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), "utf8");

  try {
    const stats = await fs.promises.stat(CONFIG_FILE_PATH);
    lastMtimeMs = stats.mtimeMs;
  } catch {
    lastMtimeMs = Date.now();
  }
  cachedRules = merged;

  return merged;
}

/**
 * Checks if a URL or host target matches the allowlist.
 * Matches:
 * 1. Exact host with port (e.g., '127.0.0.1:3026' or 'localhost:2018')
 * 2. Exact hostname (e.g., 'aidev.weebinhub.biz.id')
 */
export function isTargetAllowed(parsedUrl: URL): boolean {
  const rules = getNetworkRules();
  if (rules.allowlist.length === 0) return false;

  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const host = parsedUrl.host.toLowerCase();
  const explicitPort = parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80");
  const hostWithExplicitPort = `${hostname}:${explicitPort}`;

  for (const item of rules.allowlist) {
    const candidate = item.toLowerCase();
    if (candidate === host || candidate === hostname || candidate === hostWithExplicitPort) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if an IP or hostname matches the dynamic blocklist.
 */
export function isTargetExplicitlyBlocked(hostnameOrIp: string): boolean {
  const rules = getNetworkRules();
  const target = hostnameOrIp.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return rules.blocklist.includes(target);
}
