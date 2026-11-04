import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { EXECUTOR_CONFIG } from "./config";

export interface CachedFontFamilyVariants {
  family: string;
  regular?: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

const BUILTIN_OR_SYSTEM_FONTS = new Set([
  "helvetica",
  "helvetica-bold",
  "helvetica-oblique",
  "helvetica-boldoblique",
  "times",
  "times-roman",
  "times-bold",
  "times-italic",
  "times-bolditalic",
  "times new roman",
  "timesnewroman",
  "courier",
  "courier-bold",
  "courier-oblique",
  "courier-boldoblique",
  "courier new",
  "symbol",
  "zapfdingbats",
  "arial",
  "calibri",
  "cambria",
  "georgia",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "segoe ui",
  "consolas",
  "sans-serif",
  "serif",
  "monospace",
]);

/**
 * Older Firefox User-Agent forces Google Fonts CSS2 API to return pure `.ttf` (TrueType)
 * URLs instead of `.woff2`, which `reportlab.pdfbase.ttfonts.TTFont` requires.
 */
const TTF_USER_AGENT = "Mozilla/5.0";

const inFlightFontDownloads = new Map<string, Promise<CachedFontFamilyVariants | null>>();

function sanitizeFontSlug(family: string): string {
  return family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanCandidateFontName(raw: string): string | null {
  const base = raw
    .trim()
    .replace(/-(?:Regular|Bold|Italic|BoldItalic|BoldOblique|Oblique|Medium|SemiBold|Light)$/i, "")
    .trim();

  if (
    base.length < 3 ||
    base.length > 42 ||
    !/^[A-Za-z][A-Za-z0-9 ]+$/.test(base)
  ) {
    return null;
  }

  const lower = base.toLowerCase();
  if (BUILTIN_OR_SYSTEM_FONTS.has(lower)) {
    return null;
  }

  // Normalize Title Case if needed, or preserve clean family name
  return base;
}

/**
 * Extracts custom font families referenced in Python or Node.js code
 * (e.g. `setFont("Lexend Deca", 12)`, `fontName="Lexend Deca"`, `TTFont("Lexend Deca", ...)`).
 */
export function extractRequestedFontFamilies(code?: string): string[] {
  if (!code) return [];
  const found = new Map<string, string>(); // lowercase -> canonical name

  const patterns: RegExp[] = [
    /\bsetFont\s*\(\s*['"]([^'"]+)['"]/g,
    /\bfontName\s*=\s*['"]([^'"]+)['"]/g,
    /\bTTFont\s*\(\s*['"]([^'"]+)['"]/g,
    /\bregisterFontFamily\s*\(\s*['"]([^'"]+)['"]/g,
    /\bFont\s*\([^)]*\bname\s*=\s*['"]([^'"]+)['"]/g,
    /\bfont\s*:\s*['"]([^'"]+)['"]/g,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      const cleaned = cleanCandidateFontName(match[1]);
      if (cleaned) {
        found.set(cleaned.toLowerCase(), cleaned);
      }
    }
  }

  return Array.from(found.values()).slice(0, 8);
}

async function fetchBufferWithTimeout(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 10_000
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads and caches Regular, Bold, Italic, and BoldItalic `.ttf` files for a Google Font
 * family into `.devnuby/fonts/<slug>/`.
 */
export async function ensureGoogleFontCached(
  family: string
): Promise<CachedFontFamilyVariants | null> {
  const slug = sanitizeFontSlug(family);
  if (!slug) return null;

  const familyDir = path.join(EXECUTOR_CONFIG.fontsDir, slug);
  const metaPath = path.join(familyDir, "font-meta.json");

  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(
        await fsPromises.readFile(metaPath, "utf-8")
      ) as CachedFontFamilyVariants;
      if (meta.regular && fs.existsSync(meta.regular)) {
        return meta;
      }
    } catch {
      // Re-download if metadata is corrupt
    }
  }

  const inflight = inFlightFontDownloads.get(slug);
  if (inflight) return inflight;

  const task = (async (): Promise<CachedFontFamilyVariants | null> => {
    const encodedFamily = encodeURIComponent(family.trim()).replace(/%20/g, "+");
    // Try full italic+weight axis first, then simple weight axis fallback
    const cssUrls = [
      `https://fonts.googleapis.com/css2?family=${encodedFamily}:ital,wght@0,400;0,700;1,400;1,700&display=swap`,
      `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@400;700&display=swap`,
      `https://fonts.googleapis.com/css2?family=${encodedFamily}&display=swap`,
    ];

    let cssText = "";
    for (const cssUrl of cssUrls) {
      const buf = await fetchBufferWithTimeout(cssUrl, {
        "User-Agent": TTF_USER_AGENT,
      });
      if (buf) {
        const text = buf.toString("utf-8");
        if (text.includes("@font-face")) {
          cssText = text;
          break;
        }
      }
    }

    if (!cssText) return null;

    await fsPromises.mkdir(familyDir, { recursive: true });

    const blocks = cssText.split("@font-face");
    const variants: CachedFontFamilyVariants = { family: family.trim() };

    for (const block of blocks) {
      if (!block.includes("src:")) continue;
      const styleMatch = block.match(/font-style:\s*(normal|italic)/i);
      const weightMatch = block.match(/font-weight:\s*(\d+)/i);
      const urlMatch = block.match(/url\((https:\/\/[^)]+\.(?:ttf|otf))\)/i);

      if (!urlMatch?.[1]) continue;
      const isItalic = styleMatch?.[1]?.toLowerCase() === "italic";
      const weight = Number(weightMatch?.[1] || "400");
      const isBold = weight >= 600;

      const ttfUrl = urlMatch[1];
      const variantKey: keyof Omit<CachedFontFamilyVariants, "family"> =
        isBold && isItalic
          ? "boldItalic"
          : isBold
            ? "bold"
            : isItalic
              ? "italic"
              : "regular";

      if (variants[variantKey]) continue;

      const ttfBuf = await fetchBufferWithTimeout(ttfUrl);
      if (!ttfBuf || ttfBuf.length < 1024) continue;

      const filePath = path.join(familyDir, `${slug}-${variantKey}.ttf`);
      await fsPromises.writeFile(filePath, ttfBuf);
      variants[variantKey] = filePath;
    }

    if (!variants.regular) {
      // Fallback if only one weight was returned
      const anyPath = variants.bold || variants.italic || variants.boldItalic;
      if (!anyPath) return null;
      variants.regular = anyPath;
    }

    await fsPromises.writeFile(metaPath, JSON.stringify(variants, null, 2), "utf-8");
    return variants;
  })();

  inFlightFontDownloads.set(slug, task);
  try {
    return await task;
  } finally {
    inFlightFontDownloads.delete(slug);
  }
}

/**
 * Ensures all Google Fonts referenced in `code` are downloaded to `.devnuby/fonts/`
 * and returns all cached font families available in `.devnuby/fonts/`.
 */
export async function ensureFontsForExecution(
  code?: string
): Promise<CachedFontFamilyVariants[]> {
  const requested = extractRequestedFontFamilies(code);
  if (requested.length > 0) {
    await Promise.all(requested.map((fam) => ensureGoogleFontCached(fam)));
  }

  if (!fs.existsSync(EXECUTOR_CONFIG.fontsDir)) {
    return [];
  }

  const allCached: CachedFontFamilyVariants[] = [];
  try {
    const entries = await fsPromises.readdir(EXECUTOR_CONFIG.fontsDir, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(
        EXECUTOR_CONFIG.fontsDir,
        entry.name,
        "font-meta.json"
      );
      if (!fs.existsSync(metaPath)) continue;
      try {
        const parsed = JSON.parse(
          await fsPromises.readFile(metaPath, "utf-8")
        ) as CachedFontFamilyVariants;
        if (parsed.family && parsed.regular && fs.existsSync(parsed.regular)) {
          allCached.push(parsed);
        }
      } catch {
        // Ignore invalid metadata file
      }
    }
  } catch {
    // Ignore directory read error
  }

  return allCached;
}
