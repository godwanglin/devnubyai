import { escapeHtml } from "./xml";

/**
 * Lightweight document model shared by the legacy-format parsers (.doc, .rtf).
 * Rendered to safe HTML for the side-panel preview and to plain text for the AI.
 */

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type TextBlock =
  | { type: "paragraph"; runs: TextRun[] }
  | { type: "table"; rows: string[][] };

export function runsText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join("");
}

function renderRun(run: TextRun): string {
  let html = escapeHtml(run.text).replace(/\n/g, "<br>").replace(/\t/g, "&emsp;");
  if (run.underline) html = `<u>${html}</u>`;
  if (run.italic) html = `<em>${html}</em>`;
  if (run.bold) html = `<strong>${html}</strong>`;
  return html;
}

export function blocksToHtml(blocks: TextBlock[]): string {
  const out: string[] = [];
  let emptyStreak = 0;

  for (const block of blocks) {
    if (block.type === "table") {
      emptyStreak = 0;
      const rows = block.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td>${escapeHtml(cell).replace(/\n/g, "<br>")}</td>`)
              .join("")}</tr>`
        )
        .join("");
      out.push(`<table><tbody>${rows}</tbody></table>`);
      continue;
    }

    const isEmpty = runsText(block.runs).trim() === "";
    if (isEmpty) {
      // Collapse runs of blank paragraphs used as manual spacing
      emptyStreak++;
      if (emptyStreak > 1) continue;
      out.push("<p><br></p>");
      continue;
    }
    emptyStreak = 0;
    out.push(`<p>${block.runs.map(renderRun).join("")}</p>`);
  }

  return out.join("");
}

export function blocksToPlainText(blocks: TextBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "table") {
      for (const row of block.rows) {
        lines.push(`| ${row.map((c) => c.replace(/\s*\n\s*/g, " ").trim()).join(" | ")} |`);
      }
      lines.push("");
    } else {
      lines.push(runsText(block.runs));
    }
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Merges adjacent runs that share the same formatting. */
export function pushRun(runs: TextRun[], run: TextRun) {
  if (!run.text) return;
  const last = runs[runs.length - 1];
  if (
    last &&
    Boolean(last.bold) === Boolean(run.bold) &&
    Boolean(last.italic) === Boolean(run.italic) &&
    Boolean(last.underline) === Boolean(run.underline)
  ) {
    last.text += run.text;
  } else {
    runs.push({ ...run });
  }
}
