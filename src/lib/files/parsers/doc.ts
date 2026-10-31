import type { TextBlock } from "./text-blocks";

/**
 * Text extraction for legacy Word 97–2003 binary documents (.doc).
 *
 * Reads the OLE compound file via SheetJS' bundled CFB reader, then walks the piece
 * table (CLX) from the FIB to reassemble the main document text. Formatting is not
 * recovered; paragraphs and table rows/cells are.
 */

interface CfbEntry {
  content?: ArrayLike<number>;
}

interface CfbApi {
  read: (data: Uint8Array, opts: { type: "array" | "buffer" }) => unknown;
  find: (cfb: unknown, path: string) => CfbEntry | null;
}

export class DocParseError extends Error {}

function toBytes(content: ArrayLike<number> | undefined): Uint8Array {
  if (!content) return new Uint8Array(0);
  return content instanceof Uint8Array ? content : Uint8Array.from(content);
}

function decodeCp1252(bytes: Uint8Array): string {
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    let out = "";
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
  }
}

/** Raw main-document text (still containing Word control characters). */
export async function extractDocRawText(input: Uint8Array): Promise<string> {
  const XLSX = (await import("@e965/xlsx")) as unknown as { CFB: CfbApi };
  const CFB = XLSX.CFB;

  let container: unknown;
  try {
    container = CFB.read(input, { type: "array" });
  } catch {
    throw new DocParseError("Not a valid Word document (.doc).");
  }

  const wordStream = toBytes(CFB.find(container, "WordDocument")?.content);
  if (wordStream.length < 0x200) {
    throw new DocParseError("WordDocument stream not found.");
  }

  const view = new DataView(wordStream.buffer, wordStream.byteOffset, wordStream.byteLength);
  const wIdent = view.getUint16(0, true);
  if (wIdent !== 0xa5ec) {
    throw new DocParseError("Unrecognized Word document header.");
  }

  const nFib = view.getUint16(2, true);
  if (nFib < 0xc1) {
    throw new DocParseError("Word 95 and older formats are not supported.");
  }

  const flags = view.getUint16(0x0a, true);
  if (flags & 0x0100) {
    throw new DocParseError("This document is password-protected.");
  }
  const tableStreamName = flags & 0x0200 ? "1Table" : "0Table";
  const tableStream = toBytes(CFB.find(container, tableStreamName)?.content);
  if (tableStream.length === 0) {
    throw new DocParseError(`${tableStreamName} stream not found.`);
  }

  // FIB layout: base(32) | csw | fibRgW | cslw | fibRgLw | cbRgFcLcb | fibRgFcLcb
  let pos = 32;
  const csw = view.getUint16(pos, true);
  pos += 2 + csw * 2;
  const cslw = view.getUint16(pos, true);
  const fibRgLwStart = pos + 2;
  pos = fibRgLwStart + cslw * 4;
  pos += 2; // cbRgFcLcb
  const fibRgFcLcbStart = pos;

  const ccpText = view.getInt32(fibRgLwStart + 3 * 4, true);
  const fcClx = view.getUint32(fibRgFcLcbStart + 33 * 8, true);
  const lcbClx = view.getUint32(fibRgFcLcbStart + 33 * 8 + 4, true);

  if (lcbClx === 0 || fcClx + lcbClx > tableStream.length) {
    throw new DocParseError("Document text table is corrupt or incomplete.");
  }

  const tView = new DataView(tableStream.buffer, tableStream.byteOffset, tableStream.byteLength);
  let p = fcClx;
  const clxEnd = fcClx + lcbClx;

  // Skip Prc entries (0x01), stop at Pcdt (0x02)
  while (p < clxEnd && tableStream[p] === 0x01) {
    const cbGrpprl = tView.getInt16(p + 1, true);
    p += 3 + cbGrpprl;
  }
  if (tableStream[p] !== 0x02) {
    throw new DocParseError("Document piece table not found.");
  }
  const lcbPlcPcd = tView.getUint32(p + 1, true);
  const plcStart = p + 5;
  const pieceCount = Math.floor((lcbPlcPcd - 4) / 12);

  const cps: number[] = [];
  for (let k = 0; k <= pieceCount; k++) {
    cps.push(tView.getUint32(plcStart + k * 4, true));
  }
  const pcdStart = plcStart + (pieceCount + 1) * 4;

  const limit = ccpText > 0 ? ccpText : Number.MAX_SAFE_INTEGER;
  let text = "";

  for (let k = 0; k < pieceCount; k++) {
    const cpStart = cps[k];
    if (cpStart >= limit) break;
    const cpEnd = Math.min(cps[k + 1], limit);
    const charCount = cpEnd - cpStart;
    if (charCount <= 0) continue;

    const fcRaw = tView.getUint32(pcdStart + k * 8 + 2, true);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;

    if (compressed) {
      const start = fc / 2;
      text += decodeCp1252(wordStream.subarray(start, start + charCount));
    } else {
      const slice = wordStream.subarray(fc, fc + charCount * 2);
      text += new TextDecoder("utf-16le").decode(slice);
    }
  }

  return text;
}

/** Converts Word's in-band control characters into paragraphs and tables. */
export function docTextToBlocks(raw: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let paragraph = "";
  let cellParagraphs: string[] = [];
  let row: string[] = [];
  let table: string[][] | null = null;
  let lastWasCellMark = false;
  // Field nesting: true while inside the instruction part (before 0x14)
  const fieldStack: boolean[] = [];

  const flushTable = () => {
    if (table && table.length > 0) blocks.push({ type: "table", rows: table });
    table = null;
  };
  const pushParagraph = (text: string) => {
    flushTable();
    blocks.push({ type: "paragraph", runs: [{ text }] });
  };

  for (const ch of raw) {
    const code = ch.charCodeAt(0);

    if (code === 0x13) {
      fieldStack.push(true);
      continue;
    }
    if (code === 0x14) {
      if (fieldStack.length) fieldStack[fieldStack.length - 1] = false;
      continue;
    }
    if (code === 0x15) {
      fieldStack.pop();
      continue;
    }
    if (fieldStack.some(Boolean)) continue;

    if (code === 0x07) {
      if (lastWasCellMark && paragraph === "" && cellParagraphs.length === 0) {
        // End-of-row mark
        if (row.length) {
          table = table ?? [];
          table.push(row);
        }
        row = [];
        lastWasCellMark = false;
        continue;
      }
      cellParagraphs.push(paragraph);
      row.push(cellParagraphs.join("\n").trim());
      cellParagraphs = [];
      paragraph = "";
      lastWasCellMark = true;
      continue;
    }
    lastWasCellMark = false;

    if (code === 0x0d || code === 0x0c || code === 0x0e) {
      if (row.length > 0) {
        // Paragraph inside a table cell
        cellParagraphs.push(paragraph);
      } else {
        pushParagraph(paragraph);
      }
      paragraph = "";
      continue;
    }
    if (code === 0x0b) {
      paragraph += "\n";
      continue;
    }
    if (code === 0x09) {
      paragraph += "\t";
      continue;
    }
    if (code === 0x1e) {
      paragraph += "-";
      continue;
    }
    if (code < 0x20 || code === 0x1f) continue;

    paragraph += ch;
  }

  if (row.length) {
    table = table ?? [];
    table.push(row);
  }
  if (paragraph || cellParagraphs.length) {
    pushParagraph([...cellParagraphs, paragraph].join("\n"));
  }
  flushTable();

  // Drop trailing empty paragraphs
  while (blocks.length) {
    const last = blocks[blocks.length - 1];
    if (last.type === "paragraph" && last.runs.every((r) => !r.text.trim())) blocks.pop();
    else break;
  }
  return blocks;
}

export async function parseDoc(input: Uint8Array): Promise<TextBlock[]> {
  return docTextToBlocks(await extractDocRawText(input));
}
