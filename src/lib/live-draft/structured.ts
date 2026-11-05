import { normalizeColor, plainInline } from "./common";
import { A4, DEFAULT_TEXT_STYLE, DRAFT_LIMITS, POINTS_PER_INCH, type DraftBlock, type DraftSection, type DraftTextStyle, type InlineNode } from "./types";

/** Drafts from the structured (JSON) input of create_document / create_presentation / create_spreadsheet. */

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

const BODY: DraftTextStyle = { ...DEFAULT_TEXT_STYLE, fontName: "Arial", fontSize: 11, leading: 15.5, spaceAfter: 8 };

function heading(level: number): DraftTextStyle {
  const sizes = [0, 20, 16, 13, 12];
  const size = sizes[Math.min(4, Math.max(1, level))];
  return { ...BODY, fontSize: size, leading: size * 1.25, bold: true, color: "#0f172a", spaceBefore: level <= 2 ? 14 : 10, spaceAfter: 6 };
}

function runsInline(runs: unknown): InlineNode[] {
  if (!Array.isArray(runs)) return [];
  return runs.map((run) => {
    const r = rec(run);
    return {
      kind: "span",
      bold: r.bold === true,
      italic: r.italic === true,
      underline: typeof r.link === "string",
      color: normalizeColor(r.color) ?? (typeof r.link === "string" ? "#2563eb" : undefined),
      fontSize: typeof r.size === "number" ? r.size : undefined,
      children: plainInline(text(r.text)),
    } as InlineNode;
  });
}

const CALLOUT_ACCENT: Record<string, string> = { info: "#2563eb", warning: "#d97706", success: "#16a34a", neutral: "#64748b" };

export function createDocumentSections(input: unknown): DraftSection[] {
  const inp = rec(input);
  const landscape = inp.orientation === "landscape";
  const blocks: DraftBlock[] = [];
  if (text(inp.title)) blocks.push({ type: "text", inline: plainInline(text(inp.title)), style: { ...heading(1), fontSize: 24, leading: 30, align: "left" } });
  if (text(inp.subtitle)) blocks.push({ type: "text", inline: plainInline(text(inp.subtitle)), style: { ...BODY, color: "#64748b", spaceAfter: 14 } });
  const sections = Array.isArray(inp.sections) ? inp.sections : [];
  for (const raw of sections.slice(0, DRAFT_LIMITS.blocks)) {
    const s = rec(raw);
    switch (s.type) {
      case "heading":
        blocks.push({ type: "text", inline: plainInline(text(s.text)), style: heading(typeof s.level === "number" ? s.level : 1) });
        break;
      case "paragraph": {
        const align = s.align === "center" || s.align === "right" || s.align === "justify" ? s.align : "left";
        blocks.push({
          type: "text",
          inline: Array.isArray(s.runs) ? runsInline(s.runs) : plainInline(text(s.text)),
          style: { ...BODY, bold: s.bold === true, italic: s.italic === true, color: normalizeColor(s.color), align },
        });
        break;
      }
      case "bullet_list":
      case "numbered_list":
        (Array.isArray(s.items) ? s.items : []).forEach((item, i) => {
          blocks.push({ type: "text", inline: plainInline(text(item)), style: { ...BODY, spaceAfter: 3, leftIndent: 18 }, bullet: s.type === "numbered_list" ? `${i + 1}.` : "•" });
        });
        break;
      case "table": {
        const headers = Array.isArray(s.headers) ? s.headers : [];
        const rows = Array.isArray(s.rows) ? s.rows : [];
        const toRow = (cells: unknown, bold = false) => (Array.isArray(cells) ? cells : []).map((cell) => ({ inline: plainInline(text(cell)), bold }));
        blocks.push({
          type: "table",
          rows: [...(headers.length ? [toRow(headers, true)] : []), ...rows.slice(0, DRAFT_LIMITS.tableRows).map((r) => toRow(r))],
          headerBackground: headers.length ? "#1e293b" : undefined,
          headerColor: headers.length ? "#ffffff" : undefined,
          zebra: s.zebra === true ? "#f1f5f9" : undefined,
          gridColor: "#cbd5e1",
          fontSize: 10,
          fontKind: "sans",
          fontName: "Arial",
        });
        break;
      }
      case "callout":
        blocks.push({ type: "callout", title: text(s.title) || undefined, inline: plainInline(text(s.text)), accent: CALLOUT_ACCENT[text(s.variant)] ?? CALLOUT_ACCENT.info });
        break;
      case "divider":
        blocks.push({ type: "rule", thickness: 1, color: "#cbd5e1", spaceBefore: 8, spaceAfter: 8, widthPercent: 100 });
        break;
      case "page_break":
        blocks.push({ type: "pagebreak" });
        break;
      default:
        break;
    }
  }
  const [w, h] = landscape ? [A4[1], A4[0]] : A4;
  return [{ kind: "flow", page: { width: w, height: h, margins: { top: 64, right: 64, bottom: 64, left: 64 } }, blocks }];
}

export function createPresentationSections(input: unknown): DraftSection[] {
  const inp = rec(input);
  const W = 10 * POINTS_PER_INCH;
  const H = 5.625 * POINTS_PER_INCH;
  const page = { width: W, height: H, margins: { top: 0, right: 0, bottom: 0, left: 0 } };
  const style = (size: number, bold = false, color = "#0f172a"): DraftTextStyle => ({ ...BODY, fontSize: size, leading: size * 1.2, bold, color, spaceAfter: 0 });
  const sections: DraftSection[] = [];
  if (text(inp.title)) {
    sections.push({
      kind: "fixed",
      page,
      background: "#ffffff",
      items: [
        { type: "text", x: 48, y: H * 0.34, w: W - 96, anchor: "start", inline: plainInline(text(inp.title)), style: { ...style(34, true), align: "center" } },
        { type: "text", x: 48, y: H * 0.56, w: W - 96, anchor: "start", inline: plainInline(text(inp.subtitle)), style: { ...style(16, false, "#64748b"), align: "center" } },
      ],
    });
  }
  for (const raw of (Array.isArray(inp.slides) ? inp.slides : []).slice(0, DRAFT_LIMITS.sections)) {
    const s = rec(raw);
    const bg = normalizeColor(s.background) ?? "#ffffff";
    const dark = /^#(?:[0-3][0-9a-f]){3}/i.test(bg);
    const ink = dark ? "#f8fafc" : "#0f172a";
    const bullets = Array.isArray(s.bullets) ? s.bullets.map(text).filter(Boolean) : [];
    const body: InlineNode[] = [];
    if (text(s.content)) body.push({ kind: "text", text: text(s.content) });
    bullets.forEach((b) => {
      if (body.length) body.push({ kind: "br" });
      body.push({ kind: "text", text: `• ${b}` });
    });
    sections.push({
      kind: "fixed",
      page,
      background: bg,
      items: [
        { type: "text", x: 40, y: 28, w: W - 80, anchor: "start", inline: plainInline(text(s.title)), style: style(26, true, ink) },
        { type: "text", x: 40, y: 92, w: W - 80, anchor: "start", inline: body, style: { ...style(16, false, ink), leading: 26 } },
      ],
    });
  }
  return sections;
}

export function createSpreadsheetSections(input: unknown): DraftSection[] {
  const inp = rec(input);
  const sheets = (Array.isArray(inp.sheets) ? inp.sheets : []).map((raw) => {
    const s = rec(raw);
    const headers = Array.isArray(s.headers) ? s.headers.map(text) : [];
    const data = (Array.isArray(s.data) ? s.data : []).slice(0, DRAFT_LIMITS.sheetRows).map((row) =>
      (Array.isArray(row) ? row : []).slice(0, DRAFT_LIMITS.sheetCols).map((cell) => {
        const c = rec(cell);
        return typeof c.formula === "string" ? c.formula : text(cell);
      })
    );
    const cells = [...(headers.length ? [headers] : []), ...data];
    const cols = Math.max(0, ...cells.map((r) => r.length));
    const grid = cells.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? null));
    return {
      name: text(s.name) || "Sheet",
      cells: grid,
      bold: grid.map((_, r) => Array.from({ length: cols }, () => r === 0 && headers.length > 0)),
      colWidths: Array.from({ length: cols }, () => 0),
    };
  });
  return sheets.length ? [{ kind: "sheets", sheets }] : [];
}
