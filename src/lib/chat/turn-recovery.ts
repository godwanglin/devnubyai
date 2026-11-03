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
]);

type StoredPart = Record<string, unknown>;

function isSuccessfulToolPart(part: StoredPart): boolean {
  return part.type === "dynamic-tool" && part.state === "output-available";
}

export function hasSuccessfulToolResult(parts: StoredPart[]): boolean {
  return parts.some(isSuccessfulToolPart);
}

/** Display names of the files produced by successful tool calls, in order, deduped */
export function listProducedFiles(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  const names: string[] = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as StoredPart;
    if (!isSuccessfulToolPart(part) || !FILE_TOOL_NAMES.has(String(part.toolName))) continue;
    const output = (part.output && typeof part.output === "object" ? part.output : {}) as StoredPart;
    const input = (part.input && typeof part.input === "object" ? part.input : {}) as StoredPart;
    const name = [output.displayName, output.filename, input.filename].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    );
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
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
      "_Ringkasan akhir tidak sempat dibuat karena model terlalu lama merespons. Kirim \"lanjutkan\" bila masih ada bagian yang perlu dikerjakan._"
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

/** Assistant content for history: its prose plus a note of the files it produced */
export function withProducedFilesNote(content: string, parts: unknown): string {
  const files = listProducedFiles(parts);
  if (files.length === 0) return content;
  const note = `[Files created in this turn: ${files.join(", ")}]`;
  return content.trim() ? `${content}\n\n${note}` : note;
}
