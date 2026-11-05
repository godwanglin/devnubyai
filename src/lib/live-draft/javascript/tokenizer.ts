/**
 * Forgiving JavaScript tokenizer for half-written Node scripts (docx, pptxgenjs).
 * Template literals keep their raw parts; `${…}` sources are parsed later.
 */

export type JsToken =
  | { t: "name"; v: string }
  | { t: "num"; v: number }
  | { t: "str"; v: string; complete: boolean }
  | { t: "tpl"; parts: (string | { src: string })[]; complete: boolean }
  | { t: "op"; v: string };

const PUNCT = [">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"];
const NAME_START = /[\p{L}_$]/u;
const NAME_PART = /[\p{L}\p{N}_$]/u;
const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

function unescape(body: string): string {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r?\n|.)/g, (_m, esc: string) => {
    if (esc.startsWith("u{")) return String.fromCodePoint(Math.min(0x10ffff, parseInt(esc.slice(2, -1), 16) || 0));
    if (esc[0] === "u" || esc[0] === "x") return String.fromCharCode(parseInt(esc.slice(1), 16) || 0);
    if (esc === "\n" || esc === "\r\n") return "";
    return ESC[esc] ?? esc;
  });
}

/** Tokens that can end an expression: a following `/` is division, not a regex. */
function endsExpression(tok: JsToken | undefined): boolean {
  if (!tok) return false;
  if (tok.t === "num" || tok.t === "str" || tok.t === "tpl") return true;
  if (tok.t === "name") return !["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "await", "yield"].includes(tok.v);
  return tok.v === ")" || tok.v === "]" || tok.v === "}";
}

export function tokenizeJs(source: string, maxChars = 200_000): JsToken[] {
  const src = source.length > maxChars ? source.slice(0, maxChars) : source;
  const out: JsToken[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let complete = false;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          complete = true;
          break;
        }
        if (src[j] === "\n") break;
        j += 1;
      }
      out.push({ t: "str", v: unescape(src.slice(i + 1, Math.min(j, n))), complete });
      i = complete ? j + 1 : j;
      continue;
    }
    if (ch === "`") {
      const parts: (string | { src: string })[] = [];
      let buf = "";
      let j = i + 1;
      let complete = false;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          buf += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (c === "`") {
          complete = true;
          break;
        }
        if (c === "$" && src[j + 1] === "{") {
          if (buf) parts.push(unescape(buf));
          buf = "";
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === "{") depth += 1;
            else if (src[k] === "}") depth -= 1;
            else if (src[k] === "'" || src[k] === '"' || src[k] === "`") {
              const q = src[k];
              k += 1;
              while (k < n && src[k] !== q) k += src[k] === "\\" ? 2 : 1;
            }
            if (depth > 0) k += 1;
          }
          parts.push({ src: src.slice(j + 2, Math.min(k, n)) });
          j = k + 1;
          continue;
        }
        buf += c;
        j += 1;
      }
      if (buf) parts.push(unescape(buf));
      out.push({ t: "tpl", parts, complete });
      i = complete ? j + 1 : n;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)n?/.exec(src.slice(i, i + 64));
      const text = m?.[0] || ch;
      const clean = text.replace(/_/g, "").replace(/n$/, "");
      const value = /^0[xbo]/i.test(clean) ? Number(clean) : parseFloat(clean);
      out.push({ t: "num", v: Number.isFinite(value) ? value : 0 });
      i += text.length;
      continue;
    }
    if (NAME_START.test(ch)) {
      let j = i + 1;
      while (j < n && NAME_PART.test(src[j])) j += 1;
      out.push({ t: "name", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "/" && !endsExpression(out[out.length - 1])) {
      // Regex literal: skipped as an opaque value
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j += 1;
      }
      j += 1;
      while (j < n && /[a-z]/i.test(src[j])) j += 1;
      out.push({ t: "name", v: "__regex__" });
      i = j;
      continue;
    }
    const op = PUNCT.find((p) => src.startsWith(p, i)) ?? ch;
    out.push({ t: "op", v: op });
    i += op.length;
  }
  return out;
}
