import type {
  CreateDocumentParams,
  DocumentInlineRun,
  DocumentParagraphSection,
} from "../tools/create-document";

type FontKey = "F1" | "F2" | "F3" | "F4";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface StyledToken {
  text: string;
  font: FontKey;
  fontSize: number;
  color: RgbColor;
  link?: string;
  width: number;
  isSpace: boolean;
  isNewline?: boolean;
}

interface LinkAnnotation {
  rect: [number, number, number, number]; // [x1, y1, x2, y2] in PDF coordinates
  uri: string;
}

interface PdfPageDraft {
  commands: string[];
  links: LinkAnnotation[];
}

const WIN_ANSI_EXTRA_MAP: Record<number, number> = {
  0x20ac: 128, // €
  0x201a: 130, // ‚
  0x0192: 131, // ƒ
  0x201e: 132, // „
  0x2026: 133, // …
  0x2020: 134, // †
  0x2021: 135, // ‡
  0x02c6: 136, // ˆ
  0x2030: 137, // ‰
  0x0160: 138, // Š
  0x2039: 139, // ‹
  0x0152: 140, // Œ
  0x017d: 142, // Ž
  0x2018: 145, // ‘
  0x2019: 146, // ’
  0x201c: 147, // “
  0x201d: 148, // ”
  0x2022: 149, // •
  0x2013: 150, // –
  0x2014: 151, // —
  0x02dc: 152, // ˜
  0x2122: 153, // ™
  0x0161: 154, // š
  0x203a: 155, // ›
  0x0153: 156, // œ
  0x017e: 158, // ž
  0x0178: 159, // Ÿ
};

function selectFont(bold?: boolean, italic?: boolean): FontKey {
  if (bold && italic) return "F4";
  if (bold) return "F2";
  if (italic) return "F3";
  return "F1";
}

function hexToRgb(raw: string | undefined, fallback: RgbColor): RgbColor {
  if (!raw) return fallback;
  const cleaned = raw.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return fallback;
  const num = parseInt(cleaned, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

function fmtNum(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function fmtRgb(c: RgbColor): string {
  return `${fmtNum(c.r)} ${fmtNum(c.g)} ${fmtNum(c.b)}`;
}

/**
 * Encodes a JavaScript Unicode string into a PDF literal string `(...)` using WinAnsiEncoding.
 */
function encodePdfLiteral(input: string): string {
  let out = "(";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    let byte: number;
    if (code >= 0x20 && code <= 0x7e) {
      byte = code;
    } else if (code >= 0xa0 && code <= 0xff) {
      byte = code;
    } else if (WIN_ANSI_EXTRA_MAP[code] !== undefined) {
      byte = WIN_ANSI_EXTRA_MAP[code];
    } else if (code === 0x2192) {
      // -> arrow fallback
      out += "->";
      continue;
    } else {
      byte = 0x3f; // '?'
    }

    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += "\\" + String.fromCharCode(byte);
    } else if (byte < 0x20 || byte > 0x7e) {
      out += "\\" + byte.toString(8).padStart(3, "0");
    } else {
      out += String.fromCharCode(byte);
    }
  }
  out += ")";
  return out;
}

/**
 * Approximates Helvetica glyph widths in points so line wrapping and alignment are accurate.
 */
function measureCharFactor(ch: string, bold: boolean): number {
  if ("ilI.,:;!|'` ".includes(ch)) return bold ? 0.31 : 0.28;
  if ("ftrj()[]{}\"-".includes(ch)) return bold ? 0.38 : 0.34;
  if ("mwMW@#%&QOGD".includes(ch)) return bold ? 0.78 : 0.73;
  if (ch >= "A" && ch <= "Z") return bold ? 0.67 : 0.63;
  if (ch >= "0" && ch <= "9") return bold ? 0.56 : 0.54;
  return bold ? 0.55 : 0.51;
}

function measureTextWidth(text: string, fontSize: number, font: FontKey): number {
  const bold = font === "F2" || font === "F4";
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    total += measureCharFactor(text[i], bold) * fontSize;
  }
  return total;
}

function tokenizeRuns(
  runs: Array<{
    text: string;
    bold?: boolean;
    italic?: boolean;
    color: RgbColor;
    fontSize: number;
    link?: string;
  }>
): StyledToken[] {
  const tokens: StyledToken[] = [];
  for (const run of runs) {
    const font = selectFont(run.bold, run.italic);
    const lines = (run.text || "").split(/\r?\n/);
    lines.forEach((line, lineIdx) => {
      if (lineIdx > 0) {
        tokens.push({
          text: "",
          font,
          fontSize: run.fontSize,
          color: run.color,
          width: 0,
          isSpace: false,
          isNewline: true,
        });
      }
      const parts = line.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        const isSpace = /^\s+$/.test(part);
        const normalized = isSpace ? " " : part;
        tokens.push({
          text: normalized,
          font,
          fontSize: run.fontSize,
          color: run.color,
          link: run.link,
          width: measureTextWidth(normalized, run.fontSize, font),
          isSpace,
        });
      }
    });
  }
  return tokens;
}

function wrapTokens(tokens: StyledToken[], maxWidth: number): StyledToken[][] {
  const lines: StyledToken[][] = [];
  let current: StyledToken[] = [];
  let currentWidth = 0;

  for (const tok of tokens) {
    if (tok.isNewline) {
      lines.push(current);
      current = [];
      currentWidth = 0;
      continue;
    }
    if (tok.isSpace && current.length === 0) {
      continue;
    }
    if (!tok.isSpace && tok.width > maxWidth) {
      // Break an ultra-long unbroken word/URL into chunks that fit maxWidth
      if (current.length > 0) {
        lines.push(current);
        current = [];
        currentWidth = 0;
      }
      let chunk = "";
      for (const ch of tok.text) {
        const nextChunk = chunk + ch;
        if (measureTextWidth(nextChunk, tok.fontSize, tok.font) > maxWidth && chunk.length > 0) {
          lines.push([
            {
              ...tok,
              text: chunk,
              width: measureTextWidth(chunk, tok.fontSize, tok.font),
            },
          ]);
          chunk = ch;
        } else {
          chunk = nextChunk;
        }
      }
      if (chunk) {
        const w = measureTextWidth(chunk, tok.fontSize, tok.font);
        current.push({ ...tok, text: chunk, width: w });
        currentWidth = w;
      }
      continue;
    }

    if (currentWidth + tok.width > maxWidth && current.length > 0) {
      // Trim trailing spaces on completed line
      while (current.length > 0 && current[current.length - 1].isSpace) {
        current.pop();
      }
      lines.push(current);
      current = [];
      currentWidth = 0;
      if (tok.isSpace) continue;
    }

    current.push(tok);
    currentWidth += tok.width;
  }

  while (current.length > 0 && current[current.length - 1].isSpace) {
    current.pop();
  }
  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}

const SLATE_900: RgbColor = { r: 15 / 255, g: 23 / 255, b: 42 / 255 };
const SLATE_800: RgbColor = { r: 30 / 255, g: 41 / 255, b: 59 / 255 };
const SLATE_700: RgbColor = { r: 51 / 255, g: 65 / 255, b: 85 / 255 };
const SLATE_500: RgbColor = { r: 100 / 255, g: 116 / 255, b: 139 / 255 };
const SLATE_400: RgbColor = { r: 148 / 255, g: 163 / 255, b: 184 / 255 };
const SLATE_300: RgbColor = { r: 203 / 255, g: 213 / 255, b: 225 / 255 };
const SLATE_200: RgbColor = { r: 226 / 255, g: 232 / 255, b: 240 / 255 };
const SLATE_50: RgbColor = { r: 248 / 255, g: 250 / 255, b: 252 / 255 };
const NAVY_800: RgbColor = { r: 30 / 255, g: 58 / 255, b: 138 / 255 };
const BLUE_600: RgbColor = { r: 37 / 255, g: 99 / 255, b: 235 / 255 };
const WHITE: RgbColor = { r: 1, g: 1, b: 1 };

/**
 * Renders structured CreateDocumentParams into a standards-compliant binary PDF 1.4 Buffer.
 */
export async function buildPdfBuffer(
  params: CreateDocumentParams,
  filename: string
): Promise<Buffer> {
  const isLandscape = params.orientation === "landscape";
  const pageWidth = isLandscape ? 841.89 : 595.28; // A4 points
  const pageHeight = isLandscape ? 595.28 : 841.89;
  const marginX = 50;
  const marginTop = 54;
  const marginBottom = 56;
  const contentWidth = pageWidth - marginX * 2;

  const pages: PdfPageDraft[] = [];
  let currentPage: PdfPageDraft = { commands: [], links: [] };
  pages.push(currentPage);

  let cursorY = pageHeight - marginTop;

  function startNewPage() {
    currentPage = { commands: [], links: [] };
    pages.push(currentPage);
    cursorY = pageHeight - marginTop;
  }

  function ensureSpace(requiredHeight: number) {
    if (cursorY - requiredHeight < marginBottom) {
      startNewPage();
    }
  }

  function drawRect(x: number, yBottom: number, w: number, h: number, fill: RgbColor) {
    currentPage.commands.push(
      `q ${fmtRgb(fill)} rg ${fmtNum(x)} ${fmtNum(yBottom)} ${fmtNum(w)} ${fmtNum(h)} re f Q`
    );
  }

  function drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: RgbColor,
    lineWidth = 0.75
  ) {
    currentPage.commands.push(
      `q ${fmtRgb(stroke)} RG ${fmtNum(lineWidth)} w ${fmtNum(x1)} ${fmtNum(y1)} m ${fmtNum(x2)} ${fmtNum(y2)} l S Q`
    );
  }

  function drawTokenLine(
    line: StyledToken[],
    xLeft: number,
    baselineY: number,
    boxWidth: number,
    align: "left" | "center" | "right" | "justify" = "left"
  ) {
    if (line.length === 0) return;
    const lineWidth = line.reduce((acc, t) => acc + t.width, 0);
    let x = xLeft;
    if (align === "center") {
      x = xLeft + Math.max(0, (boxWidth - lineWidth) / 2);
    } else if (align === "right") {
      x = xLeft + Math.max(0, boxWidth - lineWidth);
    }

    // Group adjacent tokens that share identical styling so pdf-parse keeps sentences cohesive
    let idx = 0;
    while (idx < line.length) {
      const first = line[idx];
      let combinedText = first.text;
      let combinedWidth = first.width;
      let nextIdx = idx + 1;
      while (
        nextIdx < line.length &&
        line[nextIdx].font === first.font &&
        line[nextIdx].fontSize === first.fontSize &&
        line[nextIdx].link === first.link &&
        fmtRgb(line[nextIdx].color) === fmtRgb(first.color)
      ) {
        combinedText += line[nextIdx].text;
        combinedWidth += line[nextIdx].width;
        nextIdx++;
      }

      if (combinedText.trim().length > 0) {
        currentPage.commands.push(
          `BT /${first.font} ${fmtNum(first.fontSize)} Tf ${fmtRgb(first.color)} rg 1 0 0 1 ${fmtNum(x)} ${fmtNum(baselineY)} Tm ${encodePdfLiteral(combinedText)} Tj ET`
        );
        if (first.link) {
          // Underline link and register clickable PDF URI annotation
          drawLine(
            x,
            baselineY - 1.5,
            x + combinedWidth,
            baselineY - 1.5,
            first.color,
            0.6
          );
          currentPage.links.push({
            rect: [x, baselineY - 2, x + combinedWidth, baselineY + first.fontSize],
            uri: first.link,
          });
        }
      }

      x += combinedWidth;
      idx = nextIdx;
    }
  }

  function paragraphToRuns(section: DocumentParagraphSection) {
    const baseColor = hexToRgb(section.color, SLATE_800);
    if (Array.isArray(section.runs) && section.runs.length > 0) {
      return section.runs.map((r: DocumentInlineRun) => {
        const validLink =
          r.link && /^https?:\/\//i.test(r.link.trim()) ? r.link.trim() : undefined;
        const fontSize = r.size ? Math.max(8, Math.min(28, r.size / 2)) : 11;
        return {
          text: r.text || validLink || "",
          bold: r.bold ?? section.bold,
          italic: r.italic ?? section.italic,
          color: hexToRgb(r.color, validLink ? BLUE_600 : baseColor),
          fontSize,
          link: validLink,
        };
      });
    }
    return [
      {
        text: section.text || "",
        bold: section.bold,
        italic: section.italic,
        color: baseColor,
        fontSize: 11,
      },
    ];
  }

  // 1. Optional Document Title & Subtitle
  if (params.title) {
    const titleTokens = tokenizeRuns([
      { text: params.title, bold: true, color: SLATE_900, fontSize: 22 },
    ]);
    const lines = wrapTokens(titleTokens, contentWidth);
    const lineHeight = 27;
    for (const line of lines) {
      ensureSpace(lineHeight);
      cursorY -= 20;
      drawTokenLine(line, marginX, cursorY, contentWidth, "center");
      cursorY -= 7;
    }
    cursorY -= 4;
  }

  if (params.subtitle) {
    const subTokens = tokenizeRuns([
      { text: params.subtitle, italic: true, color: SLATE_500, fontSize: 10.5 },
    ]);
    const lines = wrapTokens(subTokens, contentWidth);
    for (const line of lines) {
      ensureSpace(16);
      cursorY -= 12;
      drawTokenLine(line, marginX, cursorY, contentWidth, "center");
      cursorY -= 4;
    }
    cursorY -= 8;
  }

  if (params.title || params.subtitle) {
    drawLine(marginX, cursorY, pageWidth - marginX, cursorY, SLATE_300, 0.8);
    cursorY -= 14;
  }

  // 2. Render Document Sections
  for (const section of params.sections) {
    switch (section.type) {
      case "heading": {
        const level = section.level || 2;
        const fontSize = level === 1 ? 16 : level === 2 ? 13.5 : level === 3 ? 12 : 11;
        const color = level === 1 ? SLATE_900 : level === 2 ? NAVY_800 : SLATE_700;
        const spaceBefore = level === 1 ? 12 : 9;
        const lineHeight = fontSize * 1.3;

        const tokens = tokenizeRuns([{ text: section.text || "", bold: true, color, fontSize }]);
        const lines = wrapTokens(tokens, contentWidth);
        // Keep heading with at least 36pt of following content
        ensureSpace(spaceBefore + lines.length * lineHeight + 36);
        cursorY -= spaceBefore;
        for (const line of lines) {
          cursorY -= fontSize;
          drawTokenLine(line, marginX, cursorY, contentWidth, "left");
          cursorY -= lineHeight - fontSize;
        }
        cursorY -= 5;
        break;
      }

      case "paragraph": {
        const runs = paragraphToRuns(section);
        const tokens = tokenizeRuns(runs);
        const lines = wrapTokens(tokens, contentWidth);
        const lineHeight = 15.5;
        for (const line of lines) {
          ensureSpace(lineHeight);
          cursorY -= 11.5;
          drawTokenLine(line, marginX, cursorY, contentWidth, section.align || "left");
          cursorY -= 4;
        }
        cursorY -= 6;
        break;
      }

      case "bullet_list":
      case "numbered_list": {
        const items = Array.isArray(section.items) ? section.items : [];
        const indent = 18;
        const lineHeight = 15;
        for (let i = 0; i < items.length; i++) {
          const itemText = String(items[i] ?? "");
          const tokens = tokenizeRuns([
            { text: itemText, color: SLATE_800, fontSize: 10.8 },
          ]);
          const lines = wrapTokens(tokens, contentWidth - indent);
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            ensureSpace(lineHeight);
            cursorY -= 11;
            if (lineIdx === 0) {
              const marker = section.type === "bullet_list" ? "•" : `${i + 1}.`;
              const markerColor = section.type === "bullet_list" ? SLATE_700 : NAVY_800;
              const markerFont: FontKey = section.type === "bullet_list" ? "F1" : "F2";
              currentPage.commands.push(
                `BT /${markerFont} 10.8 Tf ${fmtRgb(markerColor)} rg 1 0 0 1 ${fmtNum(marginX + 2)} ${fmtNum(cursorY)} Tm ${encodePdfLiteral(marker)} Tj ET`
              );
            }
            drawTokenLine(
              lines[lineIdx],
              marginX + indent,
              cursorY,
              contentWidth - indent,
              "left"
            );
            cursorY -= 4;
          }
          cursorY -= 2.5;
        }
        cursorY -= 5;
        break;
      }

      case "callout": {
        const variant = section.variant || "info";
        const themes: Record<
          string,
          { bg: RgbColor; border: RgbColor; titleColor: RgbColor }
        > = {
          info: {
            bg: hexToRgb("F1F5F9", SLATE_50),
            border: hexToRgb("2563EB", BLUE_600),
            titleColor: hexToRgb("1E40AF", NAVY_800),
          },
          warning: {
            bg: hexToRgb("FEF3C7", SLATE_50),
            border: hexToRgb("D97706", BLUE_600),
            titleColor: hexToRgb("92400E", NAVY_800),
          },
          success: {
            bg: hexToRgb("DCFCE7", SLATE_50),
            border: hexToRgb("16A34A", BLUE_600),
            titleColor: hexToRgb("166534", NAVY_800),
          },
          neutral: {
            bg: hexToRgb("F8FAFC", SLATE_50),
            border: hexToRgb("64748B", SLATE_500),
            titleColor: hexToRgb("334155", SLATE_700),
          },
        };
        const theme = themes[variant] ?? themes.info;
        const padX = 14;
        const padY = 10;
        const innerWidth = contentWidth - padX * 2;

        const titleLines = section.title
          ? wrapTokens(
              tokenizeRuns([
                { text: section.title, bold: true, color: theme.titleColor, fontSize: 10.8 },
              ]),
              innerWidth
            )
          : [];
        const bodyLines = wrapTokens(
          tokenizeRuns([
            { text: section.text || "", italic: true, color: SLATE_800, fontSize: 10.5 },
          ]),
          innerWidth
        );

        const boxHeight =
          padY * 2 +
          titleLines.length * 14.5 +
          (titleLines.length > 0 ? 3 : 0) +
          bodyLines.length * 14.5;

        ensureSpace(boxHeight + 8);
        const boxBottom = cursorY - boxHeight;
        drawRect(marginX, boxBottom, contentWidth, boxHeight, theme.bg);
        drawRect(marginX, boxBottom, 3.5, boxHeight, theme.border);

        let textY = cursorY - padY;
        for (const line of titleLines) {
          textY -= 10.8;
          drawTokenLine(line, marginX + padX, textY, innerWidth, "left");
          textY -= 3.7;
        }
        if (titleLines.length > 0) textY -= 3;
        for (const line of bodyLines) {
          textY -= 10.5;
          drawTokenLine(line, marginX + padX, textY, innerWidth, "left");
          textY -= 4;
        }

        cursorY = boxBottom - 10;
        break;
      }

      case "divider": {
        ensureSpace(18);
        cursorY -= 8;
        drawLine(marginX, cursorY, pageWidth - marginX, cursorY, SLATE_300, 0.75);
        cursorY -= 10;
        break;
      }

      case "table": {
        const headers = Array.isArray(section.headers) ? section.headers : [];
        const rows = Array.isArray(section.rows) ? section.rows : [];
        const colCount = Math.max(
          headers.length,
          ...rows.map((r) => (Array.isArray(r) ? r.length : 0))
        );
        if (colCount === 0) break;

        const colWidth = contentWidth / colCount;
        const cellPadX = 7;
        const cellPadY = 6;
        const cellInnerWidth = Math.max(24, colWidth - cellPadX * 2);
        const isZebra = section.zebra !== false;

        const renderTableRow = (
          cells: (string | number)[],
          isHeader: boolean,
          rowIdx: number
        ) => {
          const textColor = isHeader ? WHITE : SLATE_800;
          const fontSize = 9.8;
          const lineHeight = 13;

          const wrappedCells = Array.from({ length: colCount }, (_, colIdx) => {
            const rawVal = String(cells[colIdx] ?? "");
            const tokens = tokenizeRuns([
              { text: rawVal, bold: isHeader, color: textColor, fontSize },
            ]);
            return wrapTokens(tokens, cellInnerWidth);
          });

          const maxLines = Math.max(1, ...wrappedCells.map((lines) => lines.length));
          const rowHeight = cellPadY * 2 + maxLines * lineHeight;

          if (cursorY - rowHeight < marginBottom) {
            startNewPage();
            if (!isHeader && headers.length > 0) {
              renderTableRow(headers, true, -1);
            }
          }

          const rowBottom = cursorY - rowHeight;
          const fillColor = isHeader
            ? SLATE_800
            : isZebra && rowIdx % 2 === 1
              ? SLATE_50
              : WHITE;

          drawRect(marginX, rowBottom, contentWidth, rowHeight, fillColor);

          for (let colIdx = 0; colIdx < colCount; colIdx++) {
            const cellX = marginX + colIdx * colWidth + cellPadX;
            const lines = wrappedCells[colIdx];
            let lineY = cursorY - cellPadY;
            for (const line of lines) {
              lineY -= fontSize;
              drawTokenLine(line, cellX, lineY, cellInnerWidth, "left");
              lineY -= lineHeight - fontSize;
            }
          }

          const borderColor = isHeader ? SLATE_400 : SLATE_200;
          drawLine(
            marginX,
            rowBottom,
            marginX + contentWidth,
            rowBottom,
            borderColor,
            isHeader ? 0.9 : 0.5
          );
          cursorY = rowBottom;
        };

        ensureSpace(36);
        drawLine(marginX, cursorY, marginX + contentWidth, cursorY, SLATE_400, 0.9);
        if (headers.length > 0) {
          renderTableRow(headers, true, -1);
        }
        for (let rIdx = 0; rIdx < rows.length; rIdx++) {
          const row = rows[rIdx];
          if (!Array.isArray(row)) continue;
          renderTableRow(row, false, rIdx);
        }
        drawLine(marginX, cursorY, marginX + contentWidth, cursorY, SLATE_400, 0.9);
        cursorY -= 12;
        break;
      }

      case "page_break": {
        startNewPage();
        break;
      }
    }
  }

  // 3. Stamp Running Headers & Footers onto Every Page
  const totalPages = pages.length;
  const shouldShowPages = params.showPageNumbers ?? Boolean(params.footerText);

  pages.forEach((p, pageIdx) => {
    if (params.headerText) {
      const headerWidth = measureTextWidth(params.headerText, 8.5, "F3");
      const hx = Math.max(marginX, pageWidth - marginX - headerWidth);
      const hy = pageHeight - 32;
      p.commands.unshift(
        `BT /F3 8.5 Tf ${fmtRgb(SLATE_400)} rg 1 0 0 1 ${fmtNum(hx)} ${fmtNum(hy)} Tm ${encodePdfLiteral(params.headerText)} Tj ET`
      );
    }

    if (params.footerText || shouldShowPages) {
      const pageLabel = `Page ${pageIdx + 1} of ${totalPages}`;
      const fullFooter =
        params.footerText && shouldShowPages
          ? `${params.footerText}  |  ${pageLabel}`
          : params.footerText || pageLabel;
      const fw = measureTextWidth(fullFooter, 8.5, "F1");
      const fx = Math.max(marginX, (pageWidth - fw) / 2);
      const fy = 28;
      p.commands.push(
        `BT /F1 8.5 Tf ${fmtRgb(SLATE_500)} rg 1 0 0 1 ${fmtNum(fx)} ${fmtNum(fy)} Tm ${encodePdfLiteral(fullFooter)} Tj ET`
      );
    }
  });

  // 4. Assemble PDF 1.4 Object Graph & Cross-Reference Table
  const objects: Map<number, string> = new Map();
  let nextObjId = 1;

  const catalogId = nextObjId++; // 1
  const pagesRootId = nextObjId++; // 2
  const font1Id = nextObjId++; // 3 Helvetica
  const font2Id = nextObjId++; // 4 Helvetica-Bold
  const font3Id = nextObjId++; // 5 Helvetica-Oblique
  const font4Id = nextObjId++; // 6 Helvetica-BoldOblique
  const infoId = nextObjId++; // 7 Info

  objects.set(
    font1Id,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  );
  objects.set(
    font2Id,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  );
  objects.set(
    font3Id,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>"
  );
  objects.set(
    font4Id,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>"
  );

  const docTitle = params.title || filename;
  objects.set(
    infoId,
    `<< /Title ${encodePdfLiteral(docTitle)} /Creator (Devnuby AI) /Producer (Devnuby AI PDF Engine) >>`
  );

  const pageObjIds: number[] = [];

  for (const p of pages) {
    const contentStream = p.commands.join("\n");
    const streamByteLen = Buffer.byteLength(contentStream, "latin1");
    const contentId = nextObjId++;
    objects.set(
      contentId,
      `<< /Length ${streamByteLen} >>\nstream\n${contentStream}\nendstream`
    );

    const annotIds: number[] = [];
    for (const link of p.links) {
      const annotId = nextObjId++;
      const [x1, y1, x2, y2] = link.rect;
      objects.set(
        annotId,
        `<< /Type /Annot /Subtype /Link /Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] /Border [0 0 0] /A << /S /URI /URI ${encodePdfLiteral(link.uri)} >> >>`
      );
      annotIds.push(annotId);
    }

    const pageId = nextObjId++;
    pageObjIds.push(pageId);
    const annotsEntry =
      annotIds.length > 0
        ? ` /Annots [${annotIds.map((id) => `${id} 0 R`).join(" ")}]`
        : "";

    objects.set(
      pageId,
      `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${fmtNum(pageWidth)} ${fmtNum(pageHeight)}] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R /F3 ${font3Id} 0 R /F4 ${font4Id} 0 R >> >> /Contents ${contentId} 0 R${annotsEntry} >>`
    );
  }

  objects.set(
    pagesRootId,
    `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjIds.length} >>`
  );
  objects.set(catalogId, `<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`);

  const chunks: Buffer[] = [];
  let byteOffset = 0;

  function pushAscii(str: string) {
    const buf = Buffer.from(str, "latin1");
    chunks.push(buf);
    byteOffset += buf.length;
  }

  pushAscii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  const offsets: number[] = [0];
  const totalObjects = nextObjId - 1;

  for (let id = 1; id <= totalObjects; id++) {
    offsets[id] = byteOffset;
    const body = objects.get(id) || "<< >>";
    pushAscii(id + " 0 obj\n" + body + "\nendobj\n");
  }

  const xrefOffset = byteOffset;
  pushAscii("xref\n0 " + (totalObjects + 1) + "\n0000000000 65535 f \n");
  for (let id = 1; id <= totalObjects; id++) {
    const offStr = String(offsets[id]).padStart(10, "0");
    pushAscii(offStr + " 00000 n \n");
  }

  pushAscii(
    "trailer\n<< /Size " +
      (totalObjects + 1) +
      " /Root " +
      catalogId +
      " 0 R /Info " +
      infoId +
      " 0 R >>\nstartxref\n" +
      xrefOffset +
      "\n%%EOF\n"
  );

  const merged = Buffer.concat(chunks);
  const unpooled = new Uint8Array(merged.length);
  unpooled.set(merged);
  return Buffer.from(unpooled.buffer);
}
