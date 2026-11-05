/**
 * Forgiving Python tokenizer for code that is still being streamed: an unterminated
 * string or bracket at the end is not an error, it is just where the AI is typing.
 * Produces logical lines (bracketed continuations joined) with their indentation.
 */

export type PyToken =
  | { t: "name"; v: string }
  | { t: "num"; v: number }
  | { t: "str"; v: string; complete: boolean; f: boolean; raw: boolean }
  | { t: "op"; v: string };

export interface PyLine {
  indent: number;
  tokens: PyToken[];
}

const MULTI_OPS = ["**=", "//=", ">>=", "<<=", "...", "**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->", ":=", "<<", ">>"];
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;
const STRING_PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0", a: "\u0007", b: "\b", f: "\f", v: "\v" };

function decodeEscapes(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{2}|N\{[^}]*\}|\n|.)/g, (_m, esc: string) => {
    if (esc === "\n") return "";
    const head = esc[0];
    if (head === "u" || head === "U" || head === "x") {
      const code = parseInt(esc.slice(1), 16);
      return Number.isFinite(code) && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    if (head === "N") return "";
    return ESCAPES[esc] ?? `\\${esc}`;
  });
}

export function tokenizePython(source: string, maxChars = 200_000): PyLine[] {
  const src = source.length > maxChars ? source.slice(0, maxChars) : source;
  const lines: PyLine[] = [];
  let tokens: PyToken[] = [];
  let depth = 0;
  let lineIndent = 0;
  let atLineStart = true;
  let i = 0;
  const n = src.length;

  const endLine = () => {
    if (tokens.length > 0) lines.push({ indent: lineIndent, tokens });
    tokens = [];
    atLineStart = true;
  };

  while (i < n) {
    const ch = src[i];

    if (atLineStart && depth === 0) {
      // Measure indentation of a new logical line
      let col = 0;
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t")) {
        col += src[j] === "\t" ? 4 - (col % 4) : 1;
        j += 1;
      }
      if (j >= n) break;
      if (src[j] === "\n" || src[j] === "\r" || src[j] === "#") {
        // Blank or comment-only line
        while (j < n && src[j] !== "\n") j += 1;
        i = j + 1;
        continue;
      }
      lineIndent = col;
      atLineStart = false;
      i = j;
      continue;
    }

    if (ch === "\n") {
      if (depth === 0) endLine();
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f") {
      i += 1;
      continue;
    }
    if (ch === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      i += src[i + 1] === "\r" ? 3 : 2;
      continue;
    }
    if (ch === "#") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }

    // Strings, with an optional prefix (f, r, b, rb, fr…)
    let prefix = "";
    if (NAME_START.test(ch)) {
      let j = i;
      while (j < n && NAME_PART.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if ((src[j] === "'" || src[j] === '"') && STRING_PREFIX.test(word)) {
        prefix = word.toLowerCase();
        i = j;
      } else {
        tokens.push({ t: "name", v: word });
        i = j;
        continue;
      }
    }

    const quoteCh = src[i];
    if (quoteCh === "'" || quoteCh === '"') {
      const triple = src.startsWith(quoteCh.repeat(3), i);
      const quote = triple ? quoteCh.repeat(3) : quoteCh;
      let j = i + quote.length;
      const isRaw = prefix.includes("r");
      let complete = false;
      while (j < n) {
        if (src[j] === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (!triple && src[j] === "\n") break;
        if (src.startsWith(quote, j)) {
          complete = true;
          break;
        }
        j += 1;
      }
      const body = src.slice(i + quote.length, Math.min(j, n));
      tokens.push({
        t: "str",
        v: isRaw ? body : decodeEscapes(body),
        complete,
        f: prefix.includes("f"),
        raw: isRaw,
      });
      i = complete ? j + quote.length : j;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)[jJ]?/.exec(src.slice(i, i + 64));
      const text = m?.[0] || ch;
      const clean = text.replace(/_/g, "").replace(/[jJ]$/, "");
      const value = /^0[xob]/i.test(clean) ? Number(clean) : parseFloat(clean);
      tokens.push({ t: "num", v: Number.isFinite(value) ? value : 0 });
      i += text.length;
      continue;
    }

    const op = MULTI_OPS.find((candidate) => src.startsWith(candidate, i)) ?? ch;
    if (op === "(" || op === "[" || op === "{") depth += 1;
    if ((op === ")" || op === "]" || op === "}") && depth > 0) depth -= 1;
    tokens.push({ t: "op", v: op });
    i += op.length;
  }
  endLine();
  return lines;
}
