import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { v7 as uuidv7 } from "uuid";

export const LOG_DIR = path.resolve(process.cwd(), ".logs");

/**
 * Ensures the .logs directory exists
 */
export async function ensureLogDir(): Promise<void> {
  try {
    await fs.promises.mkdir(LOG_DIR, { recursive: true });
  } catch (err) {
    console.error("[FILE_LOGGER_MKDIR_ERR]", err);
  }
}

/**
 * Formats a Date to YYYY-MM-DD
 */
export function getLogFileName(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}.log`;
}

export interface WriteLogEntryOptions {
  id?: string;
  type: string;
  level?: "info" | "warn" | "error" | "debug";
  timestamp?: string | Date;
  userId?: string | null;
  data: Record<string, unknown>;
}

// In-memory counter for incremental index per day file
let currentIndex = 0;
let lastDateStr = "";

function getNextIndex(dateStr: string): number {
  if (lastDateStr !== dateStr) {
    lastDateStr = dateStr;
    currentIndex = 0;
  }
  currentIndex += 1;
  return currentIndex;
}

/**
 * Appends a log entry inside an isolated `<log ...>...</log>` tag.
 * Format:
 * <log index="1" id="..." type="..." level="..." timestamp="..." userid="...">
 * { ...json }
 * </log>
 */
export async function writeLogEntry(options: WriteLogEntryOptions): Promise<string> {
  await ensureLogDir();

  const id = options.id || uuidv7();
  const now = options.timestamp ? new Date(options.timestamp) : new Date();
  const dateStr = getLogFileName(now);
  const filePath = path.join(LOG_DIR, dateStr);

  const index = getNextIndex(dateStr);
  const level = options.level || "info";
  const isoTime = now.toISOString();
  const resolvedUserId =
    options.userId ??
    (typeof options.data.userId === "string" || typeof options.data.userId === "number"
      ? String(options.data.userId)
      : null);
  const userIdAttr = resolvedUserId ? ` userid="${resolvedUserId}"` : "";

  const jsonContent = JSON.stringify(options.data, null, 2);

  const entry = `<log index="${index}" id="${id}" type="${options.type}" level="${level}" timestamp="${isoTime}"${userIdAttr}>\n${jsonContent}\n</log>\n\n`;

  try {
    await fs.promises.appendFile(filePath, entry, "utf8");
  } catch (err) {
    console.error(`[FILE_LOGGER_WRITE_ERR] failed writing to ${filePath}:`, err);
  }

  return id;
}

export interface ParsedLogEntry {
  id: string;
  index: number;
  type: string;
  level: string;
  timestamp: string;
  userId?: string | null;
  data: Record<string, unknown>;
}

export interface ReadLogsFilter {
  date?: string; // YYYY-MM-DD (defaults to today)
  type?: string; // "routing" | "tool" | etc.
  level?: string;
  search?: string;
  outcome?: string; // routing-specific filter
  gatewayId?: string; // routing-specific filter
  userId?: string; // user-specific filter
  page?: number;
  pageSize?: number;
}

export interface PaginatedLogsResult {
  items: ParsedLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  availableDates: string[];
}

/**
 * Lists available log dates in .logs folder
 */
export async function getAvailableLogDates(): Promise<string[]> {
  await ensureLogDir();
  try {
    const files = await fs.promises.readdir(LOG_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map((f) => f.replace(".log", ""))
      .sort((a, b) => b.localeCompare(a)); // Descending (newest date first)
  } catch {
    return [];
  }
}

/**
 * Reads logs from a daily log file with streaming line-by-line parser,
 * supporting filtering, search, and pagination (default 10-15 per page).
 */
export async function readLogs(filter: ReadLogsFilter = {}): Promise<PaginatedLogsResult> {
  await ensureLogDir();

  const availableDates = await getAvailableLogDates();
  const todayStr = getLogFileName().replace(".log", "");
  const targetDate = filter.date || (availableDates.includes(todayStr) ? todayStr : availableDates[0] || todayStr);
  const filePath = path.join(LOG_DIR, `${targetDate}.log`);

  const page = Math.max(1, filter.page || 1);
  const pageSize = Math.max(1, Math.min(100, filter.pageSize || 15));

  if (!fs.existsSync(filePath)) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      totalPages: 1,
      availableDates,
    };
  }

  const entries: ParsedLogEntry[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentTag: {
    index: number;
    id: string;
    type: string;
    level: string;
    timestamp: string;
    userId: string | null;
  } | null = null;
  let bufferLines: string[] = [];

  const logOpenRegex =
    /^<log\s+index="(\d+)"\s+id="([^"]+)"\s+type="([^"]+)"(?:\s+level="([^"]+)")?(?:\s+timestamp="([^"]+)")?(?:\s+userid="([^"]*)")?>/;

  const filterType = filter.type && filter.type !== "all" ? filter.type.toLowerCase() : null;
  const filterLevel = filter.level && filter.level !== "all" ? filter.level.toLowerCase() : null;
  const filterSearch = filter.search ? filter.search.trim().toLowerCase() : null;
  const filterOutcome = filter.outcome && filter.outcome !== "all" ? filter.outcome.toLowerCase() : null;
  const filterGatewayId = filter.gatewayId && filter.gatewayId !== "all" ? String(filter.gatewayId) : null;
  const filterUserId = filter.userId && filter.userId !== "all" ? String(filter.userId).trim() : null;

  for await (const line of rl) {
    if (!currentTag) {
      const match = line.match(logOpenRegex);
      if (match) {
        currentTag = {
          index: parseInt(match[1], 10),
          id: match[2],
          type: match[3],
          level: match[4] || "info",
          timestamp: match[5] || "",
          userId: match[6] || null,
        };
        bufferLines = [];
      }
    } else {
      if (line.trim() === "</log>") {
        // Tag closed, process entry
        const entryType = currentTag.type.toLowerCase();
        const entryLevel = currentTag.level.toLowerCase();

        const matchType = !filterType || entryType === filterType;
        const matchLevel = !filterLevel || entryLevel === filterLevel;
        // Fast-path reject if tag has userid attribute and it does not match filterUserId
        const fastRejectUser =
          filterUserId !== null && currentTag.userId !== null && currentTag.userId !== filterUserId;

        if (matchType && matchLevel && !fastRejectUser) {
          const rawBody = bufferLines.join("\n");
          let matchSearch = true;

          if (filterSearch) {
            const fullText = `${currentTag.id} ${currentTag.type} ${currentTag.level} ${currentTag.userId ?? ""} ${rawBody}`.toLowerCase();
            matchSearch = fullText.includes(filterSearch);
          }

          if (matchSearch) {
            let parsedData: Record<string, unknown> = {};
            try {
              parsedData = JSON.parse(rawBody);
            } catch {
              parsedData = { raw: rawBody };
            }

            // User filter (handles both new logs with userid attr and older logs with data.userId)
            if (filterUserId) {
              const itemUserId = currentTag.userId || String(parsedData.userId ?? "");
              if (itemUserId !== filterUserId) {
                currentTag = null;
                bufferLines = [];
                continue;
              }
            }

            // Outcome filter (e.g. "failed", "success", "fallback")
            if (filterOutcome) {
              const itemOutcome = String(parsedData.outcome ?? "").toLowerCase();
              const hadFallback = Boolean(parsedData.hadFallback);
              const matchesOutcome =
                itemOutcome === filterOutcome || (filterOutcome === "fallback" && hadFallback);
              if (!matchesOutcome) {
                currentTag = null;
                bufferLines = [];
                continue;
              }
            }

            // Gateway filter
            if (filterGatewayId) {
              const itemGw = String(parsedData.gatewayId ?? "");
              if (itemGw !== filterGatewayId) {
                currentTag = null;
                bufferLines = [];
                continue;
              }
            }

            entries.push({
              id: currentTag.id,
              index: currentTag.index,
              type: currentTag.type,
              level: currentTag.level,
              timestamp: currentTag.timestamp,
              userId: currentTag.userId || (parsedData.userId ? String(parsedData.userId) : null),
              data: parsedData,
            });
          }
        }

        currentTag = null;
        bufferLines = [];
      } else {
        bufferLines.push(line);
      }
    }
  }

  // Reverse so newest entries (highest index / bottom of file) appear first
  entries.reverse();

  const total = entries.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const skip = (page - 1) * pageSize;
  const paginatedItems = entries.slice(skip, skip + pageSize);

  return {
    items: paginatedItems,
    total,
    page,
    pageSize,
    totalPages,
    availableDates,
  };
}

/**
 * Safely unlinks a daily log file (e.g. "2026-11-01" or "2026-11-01.log") from the .logs directory.
 */
export async function deleteLogFile(dateStr: string): Promise<boolean> {
  const cleanDate = dateStr.replace(/\.log$/, "").trim();
  // Sanity check to avoid path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error("Invalid date format. Expected YYYY-MM-DD");
  }

  const filePath = path.join(LOG_DIR, `${cleanDate}.log`);
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[FILE_LOGGER_DELETE_ERR] failed deleting ${filePath}:`, err);
    throw err;
  }
}
