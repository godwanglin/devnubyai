/** Statement parsing for the draft interpreter's JavaScript subset. */
import { Cursor, parseAssign, parseParams, parsePattern, type JsExpr, type JsPattern, type JsStmt } from "./expressions";
import { tokenizeJs } from "./tokenizer";

/** `{ ... }` body of a function or block. */
export function parseFunctionBody(c: Cursor): JsStmt[] {
  if (!c.eatOp("{")) return [];
  const body: JsStmt[] = [];
  while (!c.eof() && !c.isOp("}")) {
    const before = c.pos;
    const stmt = parseStatement(c);
    if (stmt) body.push(stmt);
    if (c.pos === before) c.next();
  }
  c.eatOp("}");
  return body;
}

// ── Statements ─────────────────────────────────────────────────────────────

function parseBlockOrStatement(c: Cursor): JsStmt[] {
  if (c.isOp("{")) return parseFunctionBody(c);
  const stmt = parseStatement(c);
  return stmt ? [stmt] : [];
}

function parseStatement(c: Cursor): JsStmt | null {
  const tok = c.peek();
  if (!tok) return null;
  if (tok.t === "op") {
    if (tok.v === ";") {
      c.next();
      return null;
    }
    if (tok.v === "{") return { k: "block", body: parseFunctionBody(c) };
  }
  if (tok.t === "name") {
    switch (tok.v) {
      case "const":
      case "let":
      case "var": {
        c.next();
        const decls: JsStmt[] = [];
        do {
          const pattern = parsePattern(c);
          const def = (pattern as { def?: JsExpr }).def;
          decls.push({ k: "decl", pattern: { ...pattern, def: undefined } as JsPattern, init: def });
        } while (c.eatOp(","));
        c.eatOp(";");
        return decls.length === 1 ? decls[0] : { k: "block", body: decls };
      }
      case "function":
      case "async": {
        if (tok.v === "async" && !c.isName("function", 1)) break;
        if (tok.v === "async") c.next();
        c.next();
        if (c.isOp("*")) c.next();
        const nameTok = c.next();
        const params = parseParams(c);
        const fn: Extract<JsExpr, { k: "fn" }> = { k: "fn", params, body: parseFunctionBody(c) };
        return { k: "func", name: nameTok?.t === "name" ? nameTok.v : "_", fn };
      }
      case "return": {
        c.next();
        if (c.eatOp(";") || c.isOp("}")) return { k: "return" };
        const e = parseAssign(c);
        c.eatOp(";");
        return { k: "return", e };
      }
      case "if": {
        c.next();
        if (c.isOp("(")) c.skipBalanced();
        const body = parseBlockOrStatement(c);
        if (c.eatName("else")) parseBlockOrStatement(c);
        return { k: "block", body };
      }
      case "for": {
        c.next();
        c.eatName("await");
        if (!c.eatOp("(")) return null;
        const start = c.pos;
        if (c.isName("const") || c.isName("let") || c.isName("var")) c.next();
        const pattern = parsePattern(c);
        if (c.eatName("of")) {
          const iter = parseAssign(c);
          c.eatOp(")");
          return { k: "forof", pattern, iter, body: parseBlockOrStatement(c) };
        }
        // Classic or for-in loops: not run
        c.pos = start - 1;
        c.skipBalanced();
        parseBlockOrStatement(c);
        return null;
      }
      case "while":
      case "do":
      case "switch":
      case "class": {
        c.next();
        while (!c.eof() && !c.isOp("{")) c.next();
        c.skipBalanced();
        if (tok.v === "do" && c.eatName("while") && c.isOp("(")) c.skipBalanced();
        return null;
      }
      case "try": {
        c.next();
        const body = parseFunctionBody(c);
        if (c.eatName("catch")) {
          if (c.isOp("(")) c.skipBalanced();
          parseFunctionBody(c);
        }
        if (c.eatName("finally")) parseFunctionBody(c);
        return { k: "block", body };
      }
      case "throw":
      case "break":
      case "continue":
      case "import":
      case "export": {
        if (tok.v === "export" && (c.isName("const", 1) || c.isName("function", 1) || c.isName("let", 1) || c.isName("async", 1))) {
          c.next();
          return parseStatement(c);
        }
        c.next();
        while (!c.eof() && !c.isOp(";") && !c.isOp("}")) {
          if (c.isOp("(") || c.isOp("{") || c.isOp("[")) c.skipBalanced();
          else c.next();
        }
        c.eatOp(";");
        return null;
      }
      default:
        break;
    }
  }
  const e = parseAssign(c);
  c.eatOp(";");
  return { k: "expr", e };
}

export function parseJsProgram(source: string): JsStmt[] {
  const c = new Cursor(tokenizeJs(source));
  const body: JsStmt[] = [];
  while (!c.eof()) {
    const before = c.pos;
    try {
      const stmt = parseStatement(c);
      if (stmt) body.push(stmt);
    } catch {
      // A pathological statement is skipped: move past it
      c.pos = Math.max(c.pos, before + 1);
      while (!c.eof() && !c.isOp(";")) c.next();
    }
    if (c.pos === before) c.next();
  }
  return body;
}
