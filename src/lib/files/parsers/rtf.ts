import { pushRun, type TextBlock, type TextRun } from "./text-blocks";

/**
 * Rich Text Format (.rtf) parser producing paragraphs (bold/italic/underline runs)
 * and simple tables. Embedded pictures, objects, headers/footers and metadata
 * destinations are skipped.
 */

interface GroupState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  skip: boolean;
  uc: number;
}

const SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "headerl", "headerr",
  "headerf", "footer", "footerl", "footerr", "footerf", "xmlnstbl", "listtable", "listoverridetable",
  "rsidtbl", "generator", "themedata", "colorschememapping", "datastore", "latentstyles", "fldinst",
  "nonshppict", "filetbl", "revtbl", "pgdsctbl", "bkmkstart", "bkmkend", "mmathpr", "wgrffmtfilter",
  "docvar", "operator", "author", "title", "subject", "keywords", "comment", "company", "fchars",
  "lchars", "pn", "pntxta", "pntxtb", "atnid", "atnauthor", "annotation", "atrfstart", "atrfend",
  "footnote", "protusertbl", "background", "shpinst", "sp", "falt", "panose", "blipuid",
]);

const SYMBOL_WORDS: Record<string, string> = {
  emdash: "—",
  endash: "–",
  bullet: "•",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
  emspace: " ",
  enspace: " ",
  qmspace: " ",
};

/** Word list bullets drawn from the Symbol/Wingdings private-use area. */
const SYMBOL_FONT_GLYPHS: Record<number, string> = {
  0xf0b7: "•",
  0xf0a7: "▪",
  0xf06e: "■",
  0xf0d8: "➢",
  0xf0fc: "✓",
  0xf076: "❖",
  0xf02d: "-",
  0xf0a8: "◆",
};

function makeDecoder(codepage: number): TextDecoder | null {
  const label = codepage === 65001 ? "utf-8" : `windows-${codepage}`;
  try {
    return new TextDecoder(label);
  } catch {
    try {
      return new TextDecoder(codepage === 936 ? "gbk" : codepage === 932 ? "shift_jis" : "windows-1252");
    } catch {
      return null;
    }
  }
}

export function parseRtf(src: string): TextBlock[] {
  if (!src.trimStart().startsWith("{\\rtf")) {
    throw new Error("Not a valid RTF document.");
  }

  const blocks: TextBlock[] = [];
  let runs: TextRun[] = [];
  let table: string[][] | null = null;
  let row: string[] = [];
  let cellText = "";
  let inTableParagraph = false;

  let state: GroupState = { bold: false, italic: false, underline: false, skip: false, uc: 1 };
  const stack: GroupState[] = [];
  let decoder = makeDecoder(1252);
  let pendingBytes: number[] = [];
  let skipChars = 0;
  // Set after "{\*": the next control word names an ignorable destination
  let ignorableNext = false;

  const flushTable = () => {
    if (table && table.length) blocks.push({ type: "table", rows: table });
    table = null;
  };

  const appendText = (text: string) => {
    if (state.skip || !text) return;
    if (inTableParagraph) {
      cellText += text;
      return;
    }
    if (table) flushTable();
    pushRun(runs, { text, bold: state.bold, italic: state.italic, underline: state.underline });
  };

  const flushBytes = () => {
    if (!pendingBytes.length) return;
    const bytes = Uint8Array.from(pendingBytes);
    pendingBytes = [];
    if (state.skip) return;
    const text = decoder
      ? decoder.decode(bytes)
      : Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    appendText(text);
  };

  const endParagraph = () => {
    flushBytes();
    if (state.skip) return;
    if (inTableParagraph) {
      cellText += "\n";
      return;
    }
    if (table) flushTable();
    blocks.push({ type: "paragraph", runs });
    runs = [];
  };

  const n = src.length;
  let i = 0;

  while (i < n) {
    const c = src[i];

    if (c === "{") {
      flushBytes();
      stack.push(state);
      state = { ...state };
      i++;
      continue;
    }
    if (c === "}") {
      flushBytes();
      state = stack.pop() ?? state;
      ignorableNext = false;
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      i++;
      continue;
    }

    if (c !== "\\") {
      if (skipChars > 0) {
        skipChars--;
        i++;
        continue;
      }
      flushBytes();
      // Fast path: consume plain text up to the next special character
      let j = i;
      while (j < n && src[j] !== "\\" && src[j] !== "{" && src[j] !== "}" && src[j] !== "\r" && src[j] !== "\n") j++;
      appendText(src.slice(i, j));
      i = j;
      continue;
    }

    // Control sequence
    const next = src[i + 1];
    if (next === undefined) break;

    if (!/[a-zA-Z]/.test(next)) {
      i += 2;
      if (next === "'") {
        const hex = src.slice(i, i + 2);
        i += 2;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        const byte = parseInt(hex, 16);
        if (Number.isFinite(byte)) pendingBytes.push(byte);
        continue;
      }
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      flushBytes();
      if (next === "*") {
        ignorableNext = true;
      } else if (next === "\\" || next === "{" || next === "}") {
        appendText(next);
      } else if (next === "~") {
        appendText(" ");
      } else if (next === "_") {
        appendText("‑");
      } else if (next === "\n" || next === "\r") {
        endParagraph();
      }
      continue;
    }

    const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(src.slice(i + 1, i + 48));
    if (!m) {
      i++;
      continue;
    }
    i += 1 + m[0].length;
    const word = m[1];
    const param = m[2] !== undefined ? parseInt(m[2], 10) : null;

    if (word !== "u" && word !== "bin") flushBytes();

    if (ignorableNext) {
      ignorableNext = false;
      if (word !== "listtext" && word !== "pntext") {
        state.skip = true;
        continue;
      }
    }
    if (SKIP_DESTINATIONS.has(word)) {
      state.skip = true;
      continue;
    }

    switch (word) {
      case "ansicpg":
        if (param) decoder = makeDecoder(param) ?? decoder;
        break;
      case "uc":
        state.uc = param ?? 1;
        break;
      case "u": {
        flushBytes();
        if (param !== null) {
          const code = param < 0 ? param + 65536 : param;
          appendText(SYMBOL_FONT_GLYPHS[code] ?? String.fromCharCode(code));
        }
        skipChars = state.uc;
        break;
      }
      case "bin":
        // Raw binary payload of `param` bytes
        i += Math.max(0, param ?? 0);
        break;
      case "par":
      case "sect":
      case "page":
        endParagraph();
        break;
      case "line":
        appendText("\n");
        break;
      case "tab":
        appendText("\t");
        break;
      case "b":
        state.bold = param !== 0;
        break;
      case "i":
        state.italic = param !== 0;
        break;
      case "ul":
      case "uld":
      case "uldb":
      case "ulw":
        state.underline = param !== 0;
        break;
      case "ulnone":
        state.underline = false;
        break;
      case "plain":
        state.bold = false;
        state.italic = false;
        state.underline = false;
        break;
      case "pard":
        inTableParagraph = false;
        break;
      case "intbl":
        inTableParagraph = true;
        break;
      case "cell":
      case "nestcell":
        if (!state.skip) {
          row.push(cellText.trim());
          cellText = "";
        }
        break;
      case "row":
      case "nestrow":
        if (!state.skip) {
          if (row.length) {
            table = table ?? [];
            table.push(row);
          }
          row = [];
          cellText = "";
        }
        break;
      default:
        if (SYMBOL_WORDS[word]) appendText(SYMBOL_WORDS[word]);
    }
  }

  flushBytes();
  if (runs.length) blocks.push({ type: "paragraph", runs });
  if (row.length) {
    table = table ?? [];
    table.push(row);
  }
  flushTable();

  while (blocks.length) {
    const last = blocks[blocks.length - 1];
    if (last.type === "paragraph" && last.runs.every((r) => !r.text.trim())) blocks.pop();
    else break;
  }
  return blocks;
}

/** RTF is 7-bit ASCII in practice; decode bytes 1:1 so \'hh escapes stay intact. */
export function decodeRtfBytes(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let k = 0; k < bytes.length; k += chunk) {
    out += String.fromCharCode(...bytes.subarray(k, k + chunk));
  }
  return out;
}
