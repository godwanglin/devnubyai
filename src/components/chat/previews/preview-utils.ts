export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

/**
 * Wraps arbitrary source code in a dynamically sized markdown code fence
 * so embedded triple-backticks never break syntax highlighting.
 */
export function wrapInCodeFence(code: string, language: string): string {
  const matches = code.match(/`+/g) || [];
  const maxBackticks = matches.reduce((max, b) => Math.max(max, b.length), 0);
  const fence = "`".repeat(Math.max(3, maxBackticks + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

/**
 * Auto-detects delimiter (`,`, `;`, or `\t`) from the first non-empty line.
 */
function detectDelimiter(text: string, forcedTab = false): string {
  if (forcedTab) return "\t";
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  let tabs = 0;

  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ",") commas++;
      else if (ch === ";") semis++;
      else if (ch === "\t") tabs++;
    }
  }

  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/**
 * RFC-4180 compliant CSV / TSV parser supporting quoted fields, escaped quotes, and multiline cells.
 */
export function parseDelimitedText(
  rawText: string,
  sheetName = "Data",
  isTsv = false
): ParsedSheet {
  const clean = rawText.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean, isTsv);
  const matrix: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const maxChars = Math.min(clean.length, 5 * 1024 * 1024);

  for (let i = 0; i < maxChars; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell);
      currentCell = "";
    } else if (ch === "\r" && next === "\n") {
      currentRow.push(currentCell);
      matrix.push(currentRow);
      currentRow = [];
      currentCell = "";
      i++;
      if (matrix.length >= 2500) break;
    } else if (ch === "\n" || ch === "\r") {
      currentRow.push(currentCell);
      matrix.push(currentRow);
      currentRow = [];
      currentCell = "";
      if (matrix.length >= 2500) break;
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    matrix.push(currentRow);
  }

  // Filter trailing completely empty row
  while (
    matrix.length > 0 &&
    matrix[matrix.length - 1].every((c) => c.trim() === "")
  ) {
    matrix.pop();
  }

  if (matrix.length === 0) {
    return { name: sheetName, headers: [], rows: [] };
  }

  const maxCols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  const rawHeaders = matrix[0] || [];
  const headers = Array.from({ length: maxCols }, (_, idx) => {
    const label = (rawHeaders[idx] ?? "").trim();
    return label || `Kolom ${idx + 1}`;
  });

  const rows = matrix.slice(1).map((r) =>
    Array.from({ length: maxCols }, (_, idx) => r[idx] ?? "")
  );

  return { name: sheetName, headers, rows };
}

export interface FindLineRangeOptions {
  firstText?: string;
  lastText?: string;
  htmlSnippet?: string;
  tagName?: string;
  id?: string;
  className?: string;
  src?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLineOfIndex(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function findLineByText(
  content: string,
  text: string,
  fromIndex = 0
): { startLine: number; endLine: number; matchIndex: number } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "selected area") return null;

  // 1. Literal substring match
  const idx = content.indexOf(trimmed, fromIndex);
  if (idx !== -1) {
    const startLine = findLineOfIndex(content, idx);
    const lineCount = Math.max(1, trimmed.split("\n").length);
    return { startLine, endLine: startLine + lineCount - 1, matchIndex: idx };
  }

  // 2. Flexible whitespace regex match (collapses whitespace differences)
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 2) {
    const sampleWords = words.slice(0, Math.min(words.length, 6)).map(escapeRegex);
    const pattern = new RegExp(sampleWords.join("[\\s\\S]{1,120}?"), "i");
    const slice = fromIndex > 0 ? content.slice(fromIndex) : content;
    const match = slice.match(pattern);
    if (match && match.index !== undefined) {
      const matchIdx = fromIndex + match.index;
      const startLine = findLineOfIndex(content, matchIdx);
      const matchLines = Math.max(1, match[0].split("\n").length);
      return { startLine, endLine: startLine + matchLines - 1, matchIndex: matchIdx };
    }
  }

  // 3. First significant line match
  const firstLine = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= 3);
  if (firstLine) {
    const fIdx = content.indexOf(firstLine, fromIndex);
    if (fIdx !== -1) {
      const startLine = findLineOfIndex(content, fIdx);
      const lineCount = Math.max(1, trimmed.split("\n").length);
      return { startLine, endLine: startLine + lineCount - 1, matchIndex: fIdx };
    }
  }

  return null;
}

/**
 * Finds the 1-based startLine and endLine of a selected target inside source code.
 * Uses a cascading strategy: literal match -> flexible whitespace -> start/end elements
 * -> HTML snippet / tag -> ID -> distinctive class -> fuzzy word overlap.
 */
export function findLineRangeInText(
  content: string,
  needle: string,
  options?: FindLineRangeOptions
): { startLine: number; endLine: number } | null {
  if (!content) return null;

  // 1. Highest Precision: Match via Unique ID attribute
  if (options?.id && options.id.trim()) {
    const cleanId = options.id.trim();
    const idRegex = new RegExp(`id\\s*=\\s*["']${escapeRegex(cleanId)}["']`, "i");
    const match = content.match(idRegex);
    if (match && match.index !== undefined) {
      const startLine = findLineOfIndex(content, match.index);
      let endLine = startLine;
      const tagMatch = content.slice(0, match.index).match(/<([a-z0-9-]+)[^>]*?$/i);
      const tag = tagMatch ? tagMatch[1].toLowerCase() : options.tagName?.toLowerCase();
      if (tag && tag !== "img" && tag !== "input" && tag !== "br" && tag !== "hr") {
        const closeTag = `</${tag}>`;
        const sliceAfter = content.slice(match.index, match.index + 3000);
        const closeIdx = sliceAfter.indexOf(closeTag);
        if (closeIdx !== -1) {
          endLine = findLineOfIndex(content, match.index + closeIdx);
        }
      }
      return { startLine, endLine: Math.max(startLine, Math.min(startLine + 25, endLine)) };
    }
  }

  // 2. High Precision: Match via Image / Media src attribute
  if (options?.src && options.src.trim()) {
    const rawSrc = options.src.trim();
    const cleanBasename = rawSrc.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "";
    if (cleanBasename && cleanBasename.length >= 3) {
      const srcRegex = new RegExp(`src\\s*=\\s*["'][^"']*${escapeRegex(cleanBasename)}["']`, "i");
      const match = content.match(srcRegex);
      if (match && match.index !== undefined) {
        const startLine = findLineOfIndex(content, match.index);
        return { startLine, endLine: startLine };
      }
    }
  }

  // 3. Try needle directly (if not placeholder)
  const directMatch = findLineByText(content, needle);
  if (directMatch) {
    return { startLine: directMatch.startLine, endLine: directMatch.endLine };
  }

  // 4. For marquee / multi-element areas: locate boundary elements (firstText to lastText)
  if (options?.firstText || options?.lastText) {
    const firstMatch = options.firstText && options.firstText !== "selected area"
      ? findLineByText(content, options.firstText)
      : null;
    const lastMatch = options.lastText && options.lastText !== "selected area"
      ? findLineByText(content, options.lastText, firstMatch ? firstMatch.matchIndex : 0)
      : null;

    if (firstMatch && lastMatch) {
      return {
        startLine: Math.min(firstMatch.startLine, lastMatch.startLine),
        endLine: Math.max(firstMatch.endLine, lastMatch.endLine),
      };
    }
    if (firstMatch) return { startLine: firstMatch.startLine, endLine: firstMatch.endLine };
    if (lastMatch) return { startLine: lastMatch.startLine, endLine: lastMatch.endLine };
  }

  // 5. Smart Multi-Class & Tag Scoring (Resilient to side-by-side / formatted code in editors)
  if (options?.className && typeof options.className === "string") {
    const genericClasses = new Set([
      "flex", "grid", "block", "inline", "inline-block", "inline-flex",
      "relative", "absolute", "fixed", "sticky",
      "w-full", "h-full", "w-screen", "h-screen",
      "hidden", "visible", "border", "rounded", "p-0", "m-0",
      "items-center", "justify-center", "text-center", "container"
    ]);

    const candidateClasses = options.className
      .split(/\s+/)
      .filter((c) => c.length >= 4 && !genericClasses.has(c));

    if (candidateClasses.length > 0) {
      const lines = content.split("\n");
      let bestLine = -1;
      let highestScore = 0;
      const targetTag = options.tagName?.toLowerCase();

      for (let i = 0; i < lines.length; i++) {
        const windowText = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join(" ");
        let score = 0;

        for (const cls of candidateClasses) {
          if (windowText.includes(cls)) {
            score += cls.length >= 8 ? 3 : 1;
          }
        }

        if (score > 0 && targetTag && windowText.includes(`<${targetTag}`)) {
          score += 2;
        }

        if (score > highestScore) {
          highestScore = score;
          bestLine = i + 1;
        }
      }

      if (bestLine !== -1 && highestScore >= 3) {
        return { startLine: bestLine, endLine: bestLine };
      }
    }
  }

  // 6. Match via HTML snippet (opening tag signature with multiline whitespace tolerance)
  if (options?.htmlSnippet) {
    const tagMatch = options.htmlSnippet.match(/<([a-z0-9-]+)([\s\S]*?)>/i);
    if (tagMatch) {
      const rawAttrs = tagMatch[2];
      const attrTokens = rawAttrs
        .match(/([a-z0-9-]+)="([^"]+)"/gi)
        ?.map((a) => a.trim())
        .filter((a) => !a.startsWith("style=") && a.length >= 8) || [];

      for (const attr of attrTokens.slice(0, 3)) {
        const aIdx = content.indexOf(attr);
        if (aIdx !== -1) {
          const startLine = findLineOfIndex(content, aIdx);
          return { startLine, endLine: startLine };
        }
      }
    }
  }

  // 7. Fuzzy word matching across lines
  const cleanWords = needle
    .replace(/[<>[\](){}"'.,;:!?/\\-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && w !== "area" && w !== "selected");

  if (cleanWords.length >= 1) {
    const lines = content.split("\n");
    let bestLine = -1;
    let maxMatches = 0;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].toLowerCase();
      let matches = 0;
      for (const w of cleanWords) {
        if (l.includes(w.toLowerCase())) matches++;
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        bestLine = i + 1;
      }
    }

    if (bestLine !== -1 && maxMatches >= 1) {
      return { startLine: bestLine, endLine: bestLine };
    }
  }

  return null;
}

