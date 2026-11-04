/**
 * Keeps long tool runs from ending empty or failed once real work is done:
 * a closing reply built from the tool results, and a history the providers accept.
 */

/** Tools whose successful output is a file the user can open or download */
const FILE_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "create_document",
  "create_spreadsheet",
  "create_presentation",
  "generate_image",
  "run_skill_script",
]);

type StoredPart = Record<string, unknown>;

function isSuccessfulToolPart(part: StoredPart): boolean {
  return part.type === "dynamic-tool" && part.state === "output-available";
}

export function hasSuccessfulToolResult(parts: StoredPart[]): boolean {
  return parts.some(isSuccessfulToolPart);
}

const INTERMEDIATE_DOC_NAME_RE =
  /(?:^_|(?:^|[_-])(?:part[_-]?\d+|bagian[_-]?\d+|draft|temp|tmp|raw)(?:[_.-]|$))/i;

/**
 * Helper artifacts created during skill verification (e.g. `page_1.png`, `poster_preview_page_1.png`,
 * `field_info.json`, or intermediate `_part1.pdf` / `part1_answers.pdf` when a final merged document exists)
 * should not be treated as primary user deliverables.
 */
export function isHelperSkillArtifactName(filename: string, allFilenames: string[] = []): boolean {
  const clean = filename.replace(/^\d+-[a-f0-9]+-/, "");
  const lower = clean.toLowerCase();
  if (lower.endsWith(".json")) return true;
  if (
    /(?:^|[_/-])(?:page[_-]?\d+|thumbnails?[_-]?\d*|slide[_-]?\d+)\.(?:png|jpe?g)$/i.test(lower) ||
    /^(?:prev\d*|cek[_-].*|.*[_-]preview)[_-]?.*\.(?:png|jpe?g)$/i.test(lower)
  ) {
    return true;
  }
  const hasFinalDoc = allFilenames.some((f) => {
    const fClean = f.replace(/^\d+-[a-f0-9]+-/, "");
    return (
      /\.(pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(fClean) &&
      !INTERMEDIATE_DOC_NAME_RE.test(fClean)
    );
  });
  if (
    hasFinalDoc &&
    /\.(pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(lower) &&
    INTERMEDIATE_DOC_NAME_RE.test(lower)
  ) {
    return true;
  }
  return false;
}

/** Display names of the files produced by successful tool calls, in order, deduped */
export function listProducedFiles(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  const rawNames: string[] = [];

  // Find the index of the last `run_skill_script` call that produced a PDF/Office document
  // so earlier modular build steps in the same turn don't list raw intermediate parts.
  let lastDocSkillPartIdx = -1;
  for (let i = 0; i < parts.length; i += 1) {
    const raw = parts[i];
    if (!raw || typeof raw !== "object") continue;
    const part = raw as StoredPart;
    if (!isSuccessfulToolPart(part) || String(part.toolName) !== "run_skill_script") continue;
    const output = (part.output && typeof part.output === "object" ? part.output : {}) as StoredPart;
    const dataObj =
      output.data && typeof output.data === "object" ? (output.data as StoredPart) : output;
    const genFiles = Array.isArray(dataObj.generatedFiles)
      ? (dataObj.generatedFiles as StoredPart[])
      : [];
    const hasDoc = genFiles.some((gf) => {
      const fn = String((gf && typeof gf === "object" ? gf.displayName || gf.filename : "") || "");
      return /\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(fn);
    });
    if (hasDoc) lastDocSkillPartIdx = i;
  }

  for (let i = 0; i < parts.length; i += 1) {
    const raw = parts[i];
    if (!raw || typeof raw !== "object") continue;
    const part = raw as StoredPart;
    if (!isSuccessfulToolPart(part) || !FILE_TOOL_NAMES.has(String(part.toolName))) continue;
    const output = (part.output && typeof part.output === "object" ? part.output : {}) as StoredPart;
    const input = (part.input && typeof part.input === "object" ? part.input : {}) as StoredPart;

    if (String(part.toolName) === "run_skill_script") {
      const dataObj =
        output.data && typeof output.data === "object" ? (output.data as StoredPart) : output;
      const genFiles = Array.isArray(dataObj.generatedFiles)
        ? (dataObj.generatedFiles as StoredPart[])
        : [];
      for (const gf of genFiles) {
        if (!gf || typeof gf !== "object") continue;
        const name = [gf.displayName, gf.filename].find(
          (v): v is string => typeof v === "string" && v.trim().length > 0
        );
        if (!name) continue;
        // Skip intermediate documents from earlier modular `run_skill_script` steps in the same turn
        if (
          lastDocSkillPartIdx >= 0 &&
          i < lastDocSkillPartIdx &&
          /\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(name)
        ) {
          continue;
        }
        if (!rawNames.includes(name)) rawNames.push(name);
      }
      continue;
    }

    const name = [output.displayName, output.filename, input.filename].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    );
    if (name && !rawNames.includes(name)) rawNames.push(name);
  }

  return rawNames.filter((name) => !isHelperSkillArtifactName(name, rawNames));
}

/**
 * Closing reply for a run whose tools succeeded but whose model gave no final prose,
 * either because it answered empty or because the synthesis call itself failed.
 */
export function buildFallbackAnswer(parts: StoredPart[], interrupted: boolean): string {
  const files = listProducedFiles(parts);
  const lines: string[] = [];
  if (files.length === 1) {
    lines.push(`File **${files[0]}** sudah selesai dibuat dan bisa dibuka atau diunduh di atas.`);
  } else if (files.length > 1) {
    lines.push("File berikut sudah selesai dibuat dan bisa dibuka atau diunduh di atas:");
    for (const name of files) lines.push(`- **${name}**`);
  } else {
    lines.push("Langkah-langkah di atas sudah selesai dijalankan.");
  }
  if (interrupted) {
    lines.push(
      "",
      "_Ringkasan akhir tidak sempat dibuat karena proses terputus. Kirim \"lanjutkan\" bila masih ada bagian yang perlu dikerjakan._"
    );
  }
  return lines.join("\n");
}

export interface HistoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/**
 * Providers reject empty assistant turns and some reject back-to-back user turns
 * (left behind when an assistant reply failed and was dropped). Empty turns go,
 * consecutive user turns are merged into one.
 */
export function sanitizeGatewayHistory(messages: HistoryMessage[]): HistoryMessage[] {
  const result: HistoryMessage[] = [];
  for (const message of messages) {
    if (!message.content.trim()) continue;
    const previous = result[result.length - 1];
    if (previous && previous.role === "user" && message.role === "user") {
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }
    result.push({ ...message });
  }
  return result;
}

/**
 * Assistant content for gateway history:
 * - Strips intermediate pre-tool status blurbs ("Saya baca dulu...", "Saya cek dulu...")
 *   so the LLM never sees a concatenated multi-step monologue without tool calls and
 *   never learns to roleplay/simulate tool execution in plain text on subsequent turns.
 * - Appends an explicit note of the tools executed and files produced (or if the turn
 *   was interrupted before producing the file).
 */
export function withProducedFilesNote(content: string, parts: unknown): string {
  const files = listProducedFiles(parts);
  const partList = Array.isArray(parts)
    ? (parts.filter((p) => p && typeof p === "object") as StoredPart[])
    : [];

  let lastToolIdx = -1;
  const toolNames: string[] = [];
  for (let i = 0; i < partList.length; i += 1) {
    const p = partList[i];
    if (p.type === "dynamic-tool") {
      lastToolIdx = i;
      const tName = typeof p.toolName === "string" ? p.toolName : "";
      if (tName && !toolNames.includes(tName)) toolNames.push(tName);
    }
  }

  let cleanProse = content.trim();
  if (lastToolIdx >= 0) {
    const postToolTexts: string[] = [];
    for (let i = lastToolIdx + 1; i < partList.length; i += 1) {
      const p = partList[i];
      if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
        postToolTexts.push(p.text.trim());
      }
    }
    if (postToolTexts.length > 0) {
      cleanProse = postToolTexts.join("\n\n");
    } else {
      // Turn ended on or right before an interrupted tool call with no closing answer
      const lastTextPart = [...partList]
        .reverse()
        .find((p) => p.type === "text" && typeof p.text === "string" && p.text.trim());
      const snippet = lastTextPart ? String(lastTextPart.text).trim() : cleanProse;
      cleanProse =
        `${snippet}\n\n` +
        `[System Note: This turn was interrupted before the final file-creation tool call completed. ` +
        `Tools run so far: ${toolNames.join(", ")}. Files produced: ${files.length > 0 ? files.join(", ") : "NONE"}.]`;
      return cleanProse.trim();
    }
  } else if (
    partList.length > 0 &&
    files.length === 0 &&
    /(?:file yang bisa diunduh|file terbaru|sudah selesai dibuat|\.pdf|\.docx|\.xlsx|\.pptx)/i.test(cleanProse)
  ) {
    // Guard against historical turns where the model roleplayed creating a file without calling tools
    cleanProse +=
      "\n\n[System Note: No tools were actually executed in this turn; no files were created or modified.]";
  }

  const metaNotes: string[] = [];
  if (toolNames.length > 0) {
    metaNotes.push(`Tools executed in this turn: ${toolNames.join(", ")}`);
  }
  if (files.length > 0) {
    metaNotes.push(`Files created/updated in this turn: ${files.join(", ")}`);
  }
  if (metaNotes.length === 0) return cleanProse;

  const noteBlock = `[${metaNotes.join(" | ")}]`;
  return cleanProse ? `${cleanProse}\n\n${noteBlock}` : noteBlock;
}
