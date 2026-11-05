/** Expression parsing for the draft interpreter's JavaScript subset (forgiving: EOF closes everything). */
import { parseFunctionBody } from "./statements";
import { tokenizeJs, type JsToken } from "./tokenizer";

export type JsExpr =
  | { k: "str"; v: string; complete: boolean }
  | { k: "num"; v: number }
  | { k: "lit"; v: boolean | null | undefined }
  | { k: "tpl"; parts: (string | JsExpr)[]; complete: boolean }
  | { k: "name"; v: string }
  | { k: "member"; obj: JsExpr; prop: string | JsExpr }
  | { k: "call"; fn: JsExpr; args: JsExpr[] }
  | { k: "new"; fn: JsExpr; args: JsExpr[] }
  | { k: "arr"; items: JsExpr[] }
  | { k: "obj"; props: ({ key: string | JsExpr; value: JsExpr } | { spread: JsExpr })[] }
  | { k: "fn"; params: JsPattern[]; body: JsStmt[] | JsExpr }
  | { k: "bin"; op: string; l: JsExpr; r: JsExpr }
  | { k: "un"; op: string; e: JsExpr }
  | { k: "cond"; test: JsExpr; a: JsExpr; b: JsExpr }
  | { k: "assign"; op: string; target: JsExpr; value: JsExpr }
  | { k: "spread"; e: JsExpr }
  | { k: "unknown" };

export type JsPattern =
  | { k: "id"; name: string; def?: JsExpr }
  | { k: "objpat"; props: { key: string; pattern: JsPattern }[]; def?: JsExpr }
  | { k: "arrpat"; items: (JsPattern | null)[]; def?: JsExpr }
  | { k: "rest"; pattern: JsPattern };

export type JsStmt =
  | { k: "decl"; pattern: JsPattern; init?: JsExpr }
  | { k: "expr"; e: JsExpr }
  | { k: "return"; e?: JsExpr }
  | { k: "block"; body: JsStmt[] }
  | { k: "forof"; pattern: JsPattern; iter: JsExpr; body: JsStmt[] }
  | { k: "func"; name: string; fn: Extract<JsExpr, { k: "fn" }> };

const UNKNOWN: JsExpr = { k: "unknown" };

export class Cursor {
  pos = 0;
  constructor(readonly toks: JsToken[]) {}
  peek(o = 0) {
    return this.toks[this.pos + o];
  }
  next() {
    return this.toks[this.pos++];
  }
  eof() {
    return this.pos >= this.toks.length;
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t?.t === "op" && t.v === v;
  }
  isName(v: string, o = 0) {
    const t = this.peek(o);
    return t?.t === "name" && t.v === v;
  }
  eatOp(v: string) {
    if (this.isOp(v)) {
      this.pos += 1;
      return true;
    }
    return false;
  }
  eatName(v: string) {
    if (this.isName(v)) {
      this.pos += 1;
      return true;
    }
    return false;
  }
  /** Skips a balanced `(...)`, `[...]` or `{...}` starting at the current token. */
  skipBalanced() {
    const open = this.next();
    if (open?.t !== "op") return;
    const close = open.v === "(" ? ")" : open.v === "[" ? "]" : "}";
    let depth = 1;
    while (!this.eof() && depth > 0) {
      const t = this.next();
      if (t?.t === "op") {
        if (t.v === open.v) depth += 1;
        else if (t.v === close) depth -= 1;
      }
    }
  }
}

function parseTemplate(tok: Extract<JsToken, { t: "tpl" }>): JsExpr {
  return {
    k: "tpl",
    complete: tok.complete,
    parts: tok.parts.map((part) => (typeof part === "string" ? part : parseJsExpression(part.src))),
  };
}

export function parseJsExpression(source: string): JsExpr {
  try {
    const c = new Cursor(tokenizeJs(source));
    return c.eof() ? UNKNOWN : parseAssign(c);
  } catch {
    return UNKNOWN;
  }
}

// ── Patterns & functions ──────────────────────────────────────────────────

export function parsePattern(c: Cursor): JsPattern {
  let pattern: JsPattern;
  if (c.eatOp("...")) return { k: "rest", pattern: parsePattern(c) };
  if (c.eatOp("{")) {
    const props: { key: string; pattern: JsPattern }[] = [];
    while (!c.eof() && !c.isOp("}")) {
      if (c.eatOp("...")) {
        parsePattern(c);
      } else {
        const keyTok = c.next();
        const key = keyTok?.t === "name" || keyTok?.t === "str" ? keyTok.v : "";
        let inner: JsPattern = { k: "id", name: key };
        if (c.eatOp(":")) inner = parsePattern(c);
        else if (c.eatOp("=")) inner = { k: "id", name: key, def: parseAssign(c) };
        props.push({ key, pattern: inner });
      }
      if (!c.eatOp(",")) break;
    }
    c.eatOp("}");
    pattern = { k: "objpat", props };
  } else if (c.eatOp("[")) {
    const items: (JsPattern | null)[] = [];
    while (!c.eof() && !c.isOp("]")) {
      if (c.isOp(",")) {
        items.push(null);
        c.next();
        continue;
      }
      items.push(parsePattern(c));
      if (!c.eatOp(",")) break;
    }
    c.eatOp("]");
    pattern = { k: "arrpat", items };
  } else {
    const tok = c.next();
    pattern = { k: "id", name: tok?.t === "name" ? tok.v : "_" };
  }
  if (c.eatOp("=")) pattern = { ...pattern, def: parseAssign(c) } as JsPattern;
  return pattern;
}

export function parseParams(c: Cursor): JsPattern[] {
  const params: JsPattern[] = [];
  c.eatOp("(");
  while (!c.eof() && !c.isOp(")")) {
    params.push(parsePattern(c));
    if (!c.eatOp(",")) break;
  }
  c.eatOp(")");
  return params;
}

function parseArrowBody(c: Cursor): JsStmt[] | JsExpr {
  return c.isOp("{") ? parseFunctionBody(c) : parseAssign(c);
}

/** Is the `(` at the cursor the parameter list of an arrow function? */
function isArrowAhead(c: Cursor): boolean {
  if (!c.isOp("(")) return false;
  let depth = 0;
  for (let i = c.pos; i < c.toks.length; i += 1) {
    const t = c.toks[i];
    if (t.t !== "op") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") depth += 1;
    else if (t.v === ")" || t.v === "]" || t.v === "}") {
      depth -= 1;
      if (depth === 0) return c.toks[i + 1]?.t === "op" && (c.toks[i + 1] as { v: string }).v === "=>";
    }
  }
  return false;
}

// ── Expressions ────────────────────────────────────────────────────────────

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "||=", "&&=", "??="]);

export function parseAssign(c: Cursor): JsExpr {
  // Arrow functions
  if (c.isName("async") && (c.isOp("(", 1) || (c.peek(1)?.t === "name" && c.isOp("=>", 2)))) c.next();
  if (c.peek()?.t === "name" && c.isOp("=>", 1)) {
    const name = (c.next() as { v: string }).v;
    c.next();
    return { k: "fn", params: [{ k: "id", name }], body: parseArrowBody(c) };
  }
  if (isArrowAhead(c)) {
    const params = parseParams(c);
    c.eatOp("=>");
    return { k: "fn", params, body: parseArrowBody(c) };
  }
  const left = parseConditional(c);
  const tok = c.peek();
  if (tok?.t === "op" && ASSIGN_OPS.has(tok.v)) {
    c.next();
    return { k: "assign", op: tok.v, target: left, value: parseAssign(c) };
  }
  return left;
}

function parseConditional(c: Cursor): JsExpr {
  const test = parseBinary(c, 0);
  if (!c.eatOp("?")) return test;
  const a = parseAssign(c);
  c.eatOp(":");
  return { k: "cond", test, a, b: parseAssign(c) };
}

const LEVELS: string[][] = [["??"], ["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!=", "===", "!=="], ["<", ">", "<=", ">=", "instanceof", "in"], ["<<", ">>", ">>>"], ["+", "-"], ["*", "/", "%"], ["**"]];

function parseBinary(c: Cursor, level: number): JsExpr {
  if (level >= LEVELS.length) return parseUnary(c);
  let left = parseBinary(c, level + 1);
  for (;;) {
    const tok = c.peek();
    const op = tok && (tok.t === "op" || tok.t === "name") ? (tok as { v: string }).v : null;
    if (!op || !LEVELS[level].includes(op)) return left;
    c.next();
    left = { k: "bin", op, l: left, r: parseBinary(c, level + 1) };
  }
}

function parseUnary(c: Cursor): JsExpr {
  const tok = c.peek();
  if (tok?.t === "op" && ["!", "-", "+", "~", "++", "--"].includes(tok.v)) {
    c.next();
    return { k: "un", op: tok.v, e: parseUnary(c) };
  }
  if (tok?.t === "name" && ["typeof", "void", "delete", "await"].includes(tok.v)) {
    c.next();
    return tok.v === "await" ? parseUnary(c) : { k: "un", op: tok.v, e: parseUnary(c) };
  }
  const expr = parsePostfix(c);
  if (c.isOp("++") || c.isOp("--")) c.next();
  return expr;
}

function parseArgs(c: Cursor): JsExpr[] {
  const args: JsExpr[] = [];
  while (!c.eof() && !c.isOp(")")) {
    args.push(c.eatOp("...") ? { k: "spread", e: parseAssign(c) } : parseAssign(c));
    if (!c.eatOp(",")) break;
  }
  c.eatOp(")");
  return args;
}

function parsePostfix(c: Cursor): JsExpr {
  let expr: JsExpr;
  if (c.eatName("new")) {
    let callee: JsExpr = parsePrimary(c);
    while (c.isOp(".")) {
      c.next();
      const t = c.next();
      callee = { k: "member", obj: callee, prop: t?.t === "name" ? t.v : "" };
    }
    expr = { k: "new", fn: callee, args: c.eatOp("(") ? parseArgs(c) : [] };
  } else {
    expr = parsePrimary(c);
  }
  for (;;) {
    if (c.isOp(".") || c.isOp("?.")) {
      c.next();
      if (c.eatOp("(")) {
        expr = { k: "call", fn: expr, args: parseArgs(c) };
        continue;
      }
      if (c.eatOp("[")) {
        const prop = parseAssign(c);
        c.eatOp("]");
        expr = { k: "member", obj: expr, prop };
        continue;
      }
      const t = c.next();
      expr = { k: "member", obj: expr, prop: t?.t === "name" ? t.v : "" };
    } else if (c.eatOp("[")) {
      const prop = parseAssign(c);
      c.eatOp("]");
      expr = { k: "member", obj: expr, prop };
    } else if (c.eatOp("(")) {
      expr = { k: "call", fn: expr, args: parseArgs(c) };
    } else if (c.peek()?.t === "tpl") {
      c.next(); // tagged template: opaque
      expr = UNKNOWN;
    } else {
      return expr;
    }
  }
}

function parseObjectLiteral(c: Cursor): JsExpr {
  const props: Extract<JsExpr, { k: "obj" }>["props"] = [];
  while (!c.eof() && !c.isOp("}")) {
    if (c.eatOp("...")) {
      props.push({ spread: parseAssign(c) });
    } else {
      if ((c.isName("async") || c.isName("get") || c.isName("set")) && c.peek(1)?.t === "name") c.next();
      let key: string | JsExpr;
      const t = c.peek();
      if (c.eatOp("[")) {
        key = parseAssign(c);
        c.eatOp("]");
      } else {
        c.next();
        key = t?.t === "name" || t?.t === "str" ? t.v : t?.t === "num" ? String(t.v) : "";
      }
      if (c.isOp("(")) {
        const params = parseParams(c);
        props.push({ key, value: { k: "fn", params, body: parseFunctionBody(c) } });
      } else if (c.eatOp(":")) {
        props.push({ key, value: parseAssign(c) });
      } else {
        // Shorthand `{ text }`
        props.push({ key, value: typeof key === "string" ? { k: "name", v: key } : UNKNOWN });
        if (c.eatOp("=")) parseAssign(c);
      }
    }
    if (!c.eatOp(",")) break;
  }
  c.eatOp("}");
  return { k: "obj", props };
}

function parsePrimary(c: Cursor): JsExpr {
  const tok = c.next();
  if (!tok) return UNKNOWN;
  switch (tok.t) {
    case "num":
      return { k: "num", v: tok.v };
    case "str":
      return { k: "str", v: tok.v, complete: tok.complete };
    case "tpl":
      return parseTemplate(tok);
    case "name":
      if (tok.v === "true" || tok.v === "false") return { k: "lit", v: tok.v === "true" };
      if (tok.v === "null") return { k: "lit", v: null };
      if (tok.v === "undefined") return { k: "lit", v: undefined };
      if (tok.v === "function") {
        if (c.peek()?.t === "name") c.next();
        const params = parseParams(c);
        return { k: "fn", params, body: parseFunctionBody(c) };
      }
      if (tok.v === "class") {
        while (!c.eof() && !c.isOp("{")) c.next();
        c.skipBalanced();
        return UNKNOWN;
      }
      return { k: "name", v: tok.v };
    case "op":
      if (tok.v === "(") {
        const inner = parseAssign(c);
        while (c.eatOp(",")) parseAssign(c);
        c.eatOp(")");
        return inner;
      }
      if (tok.v === "[") {
        const items: JsExpr[] = [];
        while (!c.eof() && !c.isOp("]")) {
          if (c.isOp(",")) {
            c.next();
            continue;
          }
          items.push(c.eatOp("...") ? { k: "spread", e: parseAssign(c) } : parseAssign(c));
          if (!c.eatOp(",")) break;
        }
        c.eatOp("]");
        return { k: "arr", items };
      }
      if (tok.v === "{") return parseObjectLiteral(c);
      return UNKNOWN;
    default:
      return UNKNOWN;
  }
}

