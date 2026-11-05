/**
 * Helper to prune heavy raw tool execution outputs into lightweight,
 * storage-friendly representations for persistence in ChatMessage.parts.
 *
 * For web_search: extracts only title, url, domain, and favicon.
 * For deep_search: keeps topic and unique source URLs.
 * For interactive_quiz: keeps question, title, and options.
 */

export interface CompactWebSource {
  title: string;
  url: string;
  domain: string;
  favicon?: string;
  snippet?: string;
}

function extractDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function getFaviconUrl(rawUrl: string): string {
  const domain = extractDomain(rawUrl);
  if (!domain) return "";
  // Google's high-speed public favicon service (sz=32 for crisp rendering)
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

export function sanitizeToolOutputForStorage(
  toolName: string,
  rawOutput: unknown
): unknown {
  if (!rawOutput || typeof rawOutput !== "object") return rawOutput;

  if (toolName === "web_search") {
    const data = rawOutput as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
    if (!Array.isArray(data.results)) return rawOutput;

    const sources: CompactWebSource[] = data.results.slice(0, 10).map((r) => {
      const url = r.url || "";
      const domain = extractDomain(url);
      return {
        title: r.title || domain || "Web Result",
        url,
        domain,
        favicon: getFaviconUrl(url),
        snippet: r.snippet ? r.snippet.slice(0, 160) : undefined,
      };
    });

    return {
      sources,
      totalResults: sources.length,
    };
  }

  if (toolName === "deep_search") {
    const data = rawOutput as {
      topic?: string;
      allSources?: string[];
      investigations?: Array<{ subQuery?: string; sources?: string[] }>;
    };

    const uniqueUrls = Array.from(new Set(data.allSources || [])).slice(0, 12);
    const sources: CompactWebSource[] = uniqueUrls.map((url) => {
      const domain = extractDomain(url);
      return {
        title: domain || "Source",
        url,
        domain,
        favicon: getFaviconUrl(url),
      };
    });

    return {
      topic: data.topic,
      sources,
      stepsExecuted: data.investigations?.length || 1,
    };
  }

  if (toolName === "read_file") {
    const data = rawOutput as {
      filename?: string;
      startLine?: number;
      endLine?: number;
      totalLines?: number;
      hasMore?: boolean;
      mimeType?: string;
    };
    return {
      filename: data.filename,
      startLine: data.startLine,
      endLine: data.endLine,
      totalLines: data.totalLines,
      hasMore: data.hasMore,
      mimeType: data.mimeType,
      // Omit heavy raw text content and visualDataUrl from database JSON storage
    };
  }

  if (toolName === "load_skill") {
    const data = rawOutput as {
      name?: string;
      title?: string;
      file?: string;
      availableDocs?: string[];
      availableScripts?: string[];
    };
    return {
      name: data.name,
      title: data.title,
      file: data.file,
      availableDocs: data.availableDocs,
      availableScripts: data.availableScripts,
    };
  }

  if (toolName === "fetch_url") {
    const data = rawOutput as {
      url?: string;
      finalUrl?: string;
      title?: string;
      status?: number;
      truncated?: boolean;
      video?: { videoId?: string; title?: string; duration?: string | null; savedFile?: string | null };
    };
    // A YouTube transcript is tens of thousands of characters: it stays in the saved
    // server file and the model's context, never in the browser or the database
    return {
      url: data.url,
      finalUrl: data.finalUrl,
      title: data.video?.title ?? data.title,
      status: data.status,
      truncated: data.truncated,
      video: data.video
        ? { videoId: data.video.videoId, duration: data.video.duration, savedFile: data.video.savedFile }
        : undefined,
    };
  }

  // interactive_quiz doesn't produce heavy output
  return rawOutput;
}
