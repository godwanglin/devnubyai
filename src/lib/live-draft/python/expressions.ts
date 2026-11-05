/** Expression parsing for the draft interpreter's Python subset (forgiving: EOF closes everything). */
import { tokenizePython, type PyToken } from "./tokenizer";

/** Expression tree of the Python subset the draft interpreter understands. */
export type PyExpr =
  | { k: "str"; v: string; complete: boolean; fparts?: FPart[] }
  | { k: "num"; v: number }
  | { k: "const"; v: boolean | null }
  | { k: "name"; v: string }
  | { k: "attr"; obj: PyExpr; name: string }
  | { k: "call"; fn: PyExpr; args: PyExpr[]; kw: [string, PyExpr][] }
  | { k: "sub"; obj: PyExpr; index: PyExpr }
  | { k: "list" | "tuple" | "set"; items: PyExpr[] }
  | { k: "dict"; entries: [PyExpr, PyExpr][] }
  | { k: "bin"; op: string; l: PyExpr; r: PyExpr }
  | { k: "un"; op: string; e: PyExpr }
  | { k: "ifexp"; body: PyExpr; cond: PyExpr; orelse: PyExpr }
  | { k: "comp"; elt: PyExpr; target: PyExpr; iter: PyExpr; cond?: PyExpr; kind: "list" | "gen" | "set" | "dict"; value?: PyExpr }
  | { k: "lambda"; params: PyParam[]; body: PyExpr }
  | { k: "star"; e: PyExpr; double?: boolean }
  | { k: "slice" }
  | { k: "unknown" };

export type FPart = string | { expr: PyExpr };

export interface PyParam {
  name: string;
  def?: PyExpr;
  star?: "*" | "**";
}

export type PyStmt =
  | { k: "expr"; e: PyExpr }
  | { k: "assign"; targets: PyExpr[]; value: PyExpr }
  | { k: "aug"; target: PyExpr; op: string; value: PyExpr }
  | { k: "def"; name: string; params: PyParam[]; body: PyStmt[] }
  | { k: "for"; target: PyExpr; iter: PyExpr; body: PyStmt[] }
  | { k: "with"; items: [PyExpr, PyExpr | null][]; body: PyStmt[] }
  | { k: "run"; body: PyStmt[] }
  | { k: "return"; e?: PyExpr };

const UNKNOWN: PyExpr = { k: "unknown" };

export class Cursor {
  pos = 0;
  constructor(private readonly toks: PyToken[]) {}
  peek(offset = 0): PyToken | undefined {
    return this.toks[this.pos + offset];
  }
  next(): PyToken | undefined {
    return this.toks[this.pos++];
  }
  eof(): boolean {
    return this.pos >= this.toks.length;
  }
  isOp(v: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok?.t === "op" && tok.v === v;
  }
  isName(v: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok?.t === "name" && tok.v === v;
  }
  eatOp(v: string): boolean {
    if (this.isOp(v)) {
      this.pos += 1;
      return true;
    }
    return false;
  }
  eatName(v: string): boolean {
    if (this.isName(v)) {
      this.pos += 1;
      return true;
    }
    return false;
  }
}

const KEYWORD_STOP = new Set(["for", "if", "else", "in", "and", "or", "not", "is", "lambda", "as", "from", "import", "async", "await", "yield"]);
const CLOSERS = new Set([")", "]", "}", ",", ":", "=", ";"]);

// ── f-strings ──────────────────────────────────────────────────────────────

function parseFString(value: string): FPart[] {
  const parts: FPart[] = [];
  let buf = "";
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "{" && value[i + 1] === "{") {
      buf += "{";
      i += 2;
      continue;
    }
    if (ch === "}" && value[i + 1] === "}") {
      buf += "}";
      i += 2;
      continue;
    }
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      let end = -1;
      while (j < value.length && depth > 0) {
        const c = value[j];
        if (c === "{" || c === "(" || c === "[") depth += 1;
        else if (c === "}" || c === ")" || c === "]") depth -= 1;
        else if (depth === 1 && end < 0 && (c === "!" || c === ":") && value[j + 1] !== "=") end = j;
        j += 1;
      }
      const inner = value.slice(i + 1, end >= 0 ? end : depth === 0 ? j - 1 : j);
      if (buf) parts.push(buf);
      buf = "";
      parts.push({ expr: parseExpressionSource(inner) });
      i = j;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf) parts.push(buf);
  return parts;
}

/** Parses a standalone expression (f-string fields). */
export function parseExpressionSource(source: string): PyExpr {
  try {
    const lines = tokenizePython(source.replace(/\n/g, " "));
    const toks = lines.flatMap((line) => line.tokens);
    return toks.length ? parseExprList(new Cursor(toks)) : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

// ── Expressions ────────────────────────────────────────────────────────────

function atEnd(c: Cursor): boolean {
  const tok = c.peek();
  return !tok || (tok.t === "op" && CLOSERS.has(tok.v)) || (tok.t === "name" && KEYWORD_STOP.has(tok.v));
}

/** `a, b, c` → tuple; a single expression otherwise. */
export function parseExprList(c: Cursor): PyExpr {
  const first = parseExpr(c);
  if (!c.isOp(",")) return first;
  const items = [first];
  while (c.eatOp(",")) {
    if (atEnd(c) && !c.isName("not") && !c.isName("lambda")) break;
    items.push(parseExpr(c));
  }
  return { k: "tuple", items };
}

export function parseExpr(c: Cursor): PyExpr {
  if (c.eatName("lambda")) {
    const params = parseParams(c, ":");
    c.eatOp(":");
    return { k: "lambda", params, body: parseExpr(c) };
  }
  if (c.isOp("*") || c.isOp("**")) {
    const double = c.next()?.v === "**";
    return { k: "star", e: parseExpr(c), double };
  }
  const body = parseOr(c);
  if (c.isName("if") && !c.isOp(":", 1)) {
    const save = c.pos;
    c.next();
    const cond = parseOr(c);
    if (c.eatName("else")) return { k: "ifexp", body, cond, orelse: parseExpr(c) };
    c.pos = save;
  }
  if (c.isOp(":=")) {
    c.next();
    return parseExpr(c);
  }
  return body;
}

function parseOr(c: Cursor): PyExpr {
  let left = parseAnd(c);
  while (c.eatName("or")) left = { k: "bin", op: "or", l: left, r: parseAnd(c) };
  return left;
}

function parseAnd(c: Cursor): PyExpr {
  let left = parseNot(c);
  while (c.eatName("and")) left = { k: "bin", op: "and", l: left, r: parseNot(c) };
  return left;
}

function parseNot(c: Cursor): PyExpr {
  if (c.eatName("not")) return { k: "un", op: "not", e: parseNot(c) };
  return parseComparison(c);
}

const COMPARE_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);

function parseComparison(c: Cursor): PyExpr {
  let left = parseBinary(c, 0);
  for (;;) {
    const tok = c.peek();
    if (tok?.t === "op" && COMPARE_OPS.has(tok.v)) {
      c.next();
      left = { k: "bin", op: tok.v, l: left, r: parseBinary(c, 0) };
    } else if (c.isName("in") || c.isName("is") || (c.isName("not") && c.isName("in", 1))) {
      const op = c.next()!.v as string;
      if (op === "not" || (op === "is" && c.isName("not"))) c.next();
      left = { k: "bin", op: op === "is" ? "is" : "in", l: left, r: parseBinary(c, 0) };
    } else {
      return left;
    }
  }
}

const BINARY_LEVELS: string[][] = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "//", "%", "@"]];

function parseBinary(c: Cursor, level: number): PyExpr {
  if (level >= BINARY_LEVELS.length) return parseUnary(c);
  let left = parseBinary(c, level + 1);
  for (;;) {
    const tok = c.peek();
    if (tok?.t !== "op" || !BINARY_LEVELS[level].includes(tok.v)) return left;
    c.next();
    left = { k: "bin", op: tok.v, l: left, r: parseBinary(c, level + 1) };
  }
}

function parseUnary(c: Cursor): PyExpr {
  if (c.isOp("-") || c.isOp("+") || c.isOp("~")) {
    const op = c.next()!.v as string;
    return { k: "un", op, e: parseUnary(c) };
  }
  if (c.eatName("await")) return parseUnary(c);
  const base = parsePostfix(c);
  if (c.eatOp("**")) return { k: "bin", op: "**", l: base, r: parseUnary(c) };
  return base;
}

function parseCallArgs(c: Cursor): { args: PyExpr[]; kw: [string, PyExpr][] } {
  const args: PyExpr[] = [];
  const kw: [string, PyExpr][] = [];
  while (!c.eof() && !c.isOp(")")) {
    const tok = c.peek();
    if (tok?.t === "name" && c.isOp("=", 1)) {
      c.next();
      c.next();
      kw.push([tok.v, parseExpr(c)]);
    } else {
      const value = parseExpr(c);
      if (c.isName("for")) {
        args.push(parseComprehension(c, value, "gen"));
      } else {
        args.push(value);
      }
    }
    if (!c.eatOp(",")) break;
  }
  c.eatOp(")");
  return { args, kw };
}

function parseSubscript(c: Cursor): PyExpr {
  if (c.isOp(":")) {
    while (!c.eof() && !c.isOp("]")) c.next();
    c.eatOp("]");
    return { k: "slice" };
  }
  const index = parseExprList(c);
  if (c.isOp(":")) {
    while (!c.eof() && !c.isOp("]")) c.next();
    c.eatOp("]");
    return { k: "slice" };
  }
  c.eatOp("]");
  return index;
}

export function parsePostfix(c: Cursor): PyExpr {
  let expr = parseAtom(c);
  for (;;) {
    if (c.eatOp("(")) {
      const { args, kw } = parseCallArgs(c);
      expr = { k: "call", fn: expr, args, kw };
    } else if (c.eatOp(".")) {
      const tok = c.next();
      expr = { k: "attr", obj: expr, name: tok?.t === "name" ? tok.v : "" };
    } else if (c.eatOp("[")) {
      expr = { k: "sub", obj: expr, index: parseSubscript(c) };
    } else {
      return expr;
    }
  }
}

function parseComprehension(c: Cursor, elt: PyExpr, kind: "list" | "gen" | "set" | "dict", value?: PyExpr): PyExpr {
  c.eatName("for");
  const target = parseTargetList(c);
  c.eatName("in");
  const iter = parseOr(c);
  let cond: PyExpr | undefined;
  while (c.isName("if") || c.isName("for")) {
    if (c.eatName("if")) cond = parseOr(c);
    else break; // nested `for` clauses are not evaluated
  }
  return { k: "comp", elt, target, iter, cond, kind, value };
}

export function parseTargetList(c: Cursor): PyExpr {
  const first = parsePostfix(c);
  if (!c.isOp(",")) return first;
  const items = [first];
  while (c.eatOp(",")) {
    if (c.isName("in")) break;
    items.push(parsePostfix(c));
  }
  return { k: "tuple", items };
}

function parseSequence(c: Cursor, closer: string, kind: "list" | "tuple" | "set"): PyExpr {
  const items: PyExpr[] = [];
  let sawComma = false;
  while (!c.eof() && !c.isOp(closer)) {
    const item = parseExpr(c);
    if (c.isName("for")) {
      const comp = parseComprehension(c, item, kind === "tuple" ? "gen" : kind);
      c.eatOp(closer);
      return comp;
    }
    items.push(item);
    if (!c.eatOp(",")) break;
    sawComma = true;
  }
  c.eatOp(closer);
  if (kind === "tuple" && items.length === 1 && !sawComma) return items[0];
  return { k: kind, items };
}

function parseDict(c: Cursor): PyExpr {
  const entries: [PyExpr, PyExpr][] = [];
  const items: PyExpr[] = [];
  while (!c.eof() && !c.isOp("}")) {
    if (c.isOp("**")) {
      c.next();
      parseExpr(c);
    } else {
      const key = parseExpr(c);
      if (c.eatOp(":")) {
        const value = parseExpr(c);
        if (c.isName("for")) {
          const comp = parseComprehension(c, key, "dict", value);
          c.eatOp("}");
          return comp;
        }
        entries.push([key, value]);
      } else {
        if (c.isName("for")) {
          const comp = parseComprehension(c, key, "set");
          c.eatOp("}");
          return comp;
        }
        items.push(key);
      }
    }
    if (!c.eatOp(",")) break;
  }
  c.eatOp("}");
  return items.length > 0 && entries.length === 0 ? { k: "set", items } : { k: "dict", entries };
}

function parseAtom(c: Cursor): PyExpr {
  const tok = c.next();
  if (!tok) return UNKNOWN;
  switch (tok.t) {
    case "num":
      return { k: "num", v: tok.v };
    case "str": {
      // Adjacent literals concatenate: 'a' 'b'
      let value = tok.v;
      let complete = tok.complete;
      let fparts: FPart[] | undefined = tok.f ? parseFString(tok.v) : undefined;
      while (c.peek()?.t === "str") {
        const nextTok = c.next() as Extract<PyToken, { t: "str" }>;
        value += nextTok.v;
        complete = nextTok.complete;
        if (fparts || nextTok.f) {
          fparts = [...(fparts ?? [tok.v]), ...(nextTok.f ? parseFString(nextTok.v) : [nextTok.v])];
        }
      }
      return { k: "str", v: value, complete, fparts };
    }
    case "name":
      if (tok.v === "True") return { k: "const", v: true };
      if (tok.v === "False") return { k: "const", v: false };
      if (tok.v === "None") return { k: "const", v: null };
      return { k: "name", v: tok.v };
    case "op":
      if (tok.v === "(") return parseSequence(c, ")", "tuple");
      if (tok.v === "[") return parseSequence(c, "]", "list");
      if (tok.v === "{") return parseDict(c);
      if (tok.v === "...") return { k: "const", v: null };
      return UNKNOWN;
    default:
      return UNKNOWN;
  }
}

export function parseParams(c: Cursor, closer: string): PyParam[] {
  const params: PyParam[] = [];
  while (!c.eof() && !c.isOp(closer)) {
    let star: PyParam["star"];
    if (c.isOp("*") || c.isOp("**")) star = c.next()!.v as "*" | "**";
    if (c.isOp("/") || (star && (c.isOp(",") || c.isOp(closer)))) {
      if (c.isOp("/")) c.next();
      if (!c.eatOp(",")) break;
      continue;
    }
    const tok = c.next();
    if (tok?.t !== "name") break;
    // Annotations are skipped
    if (closer === ")" && c.eatOp(":")) parseExpr(c);
    const param: PyParam = { name: tok.v, star };
    if (c.eatOp("=")) param.def = parseExpr(c);
    params.push(param);
    if (!c.eatOp(",")) break;
  }
  return params;
}

