import {
  Cursor,
  parseExpr,
  parseExprList,
  parseParams,
  parsePostfix,
  parseTargetList,
  type PyExpr,
  type PyStmt,
} from "./expressions";
import { tokenizePython, type PyLine, type PyToken } from "./tokenizer";

export type { FPart, PyExpr, PyParam, PyStmt } from "./expressions";

// ── Statements ─────────────────────────────────────────────────────────────

/** Index of the `:` that ends a compound statement header (depth 0). */
function headerColon(toks: PyToken[], from: number): number {
  let depth = 0;
  for (let i = from; i < toks.length; i += 1) {
    const tok = toks[i];
    if (tok.t !== "op") continue;
    if (tok.v === "(" || tok.v === "[" || tok.v === "{") depth += 1;
    else if (tok.v === ")" || tok.v === "]" || tok.v === "}") depth -= 1;
    else if (tok.v === ":" && depth === 0) return i;
    else if (tok.v === "lambda") depth += 0;
  }
  return -1;
}

function splitTopLevel(toks: PyToken[], separator: string): PyToken[][] {
  const parts: PyToken[][] = [[]];
  let depth = 0;
  for (const tok of toks) {
    if (tok.t === "op") {
      if (tok.v === "(" || tok.v === "[" || tok.v === "{") depth += 1;
      else if (tok.v === ")" || tok.v === "]" || tok.v === "}") depth -= 1;
      else if (tok.v === separator && depth === 0) {
        parts.push([]);
        continue;
      }
    }
    parts[parts.length - 1].push(tok);
  }
  return parts;
}

const AUG_OPS = new Set(["+=", "-=", "*=", "/=", "//=", "%=", "**=", "|=", "&="]);

function parseSimple(toks: PyToken[]): PyStmt[] {
  const stmts: PyStmt[] = [];
  for (const part of splitTopLevel(toks, ";")) {
    if (part.length === 0) continue;
    const head = part[0];
    if (head.t === "name") {
      if (head.v === "return") {
        stmts.push({ k: "return", e: part.length > 1 ? parseExprList(new Cursor(part.slice(1))) : undefined });
        continue;
      }
      if (["import", "from", "pass", "break", "continue", "global", "nonlocal", "assert", "del", "raise", "print"].includes(head.v) && !(head.v === "print" && part[1]?.t === "op" && part[1].v === "(")) {
        continue;
      }
    }
    const augIndex = part.findIndex((tok) => tok.t === "op" && AUG_OPS.has(tok.v));
    if (augIndex > 0) {
      stmts.push({
        k: "aug",
        target: parseExprList(new Cursor(part.slice(0, augIndex))),
        op: (part[augIndex] as { v: string }).v,
        value: parseExprList(new Cursor(part.slice(augIndex + 1))),
      });
      continue;
    }
    const pieces = splitTopLevel(part, "=");
    if (pieces.length > 1) {
      const targets = pieces.slice(0, -1).map((p) => {
        // `x: int = 1` annotations
        const colon = p.findIndex((tok) => tok.t === "op" && tok.v === ":");
        return parseExprList(new Cursor(colon > 0 ? p.slice(0, colon) : p));
      });
      stmts.push({ k: "assign", targets, value: parseExprList(new Cursor(pieces[pieces.length - 1])) });
      continue;
    }
    stmts.push({ k: "expr", e: parseExprList(new Cursor(part)) });
  }
  return stmts;
}

function parseBlock(lines: PyLine[], start: number, parentIndent: number): { body: PyStmt[]; next: number } {
  const body: PyStmt[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent > parentIndent) {
    const { stmts, next } = parseStatement(lines, i);
    body.push(...stmts);
    i = next;
  }
  return { body, next: i };
}

/** Body of a compound statement: inline after the colon, or the indented lines below. */
function compoundBody(lines: PyLine[], index: number, colon: number): { body: PyStmt[]; next: number } {
  const line = lines[index];
  if (colon >= 0 && colon < line.tokens.length - 1) {
    return { body: parseSimple(line.tokens.slice(colon + 1)), next: index + 1 };
  }
  return parseBlock(lines, index + 1, line.indent);
}

function parseStatement(lines: PyLine[], index: number): { stmts: PyStmt[]; next: number } {
  const line = lines[index];
  let toks = line.tokens;
  let first = toks[0];
  // Decorators and `async def` / `async for`
  if (first.t === "op" && first.v === "@") return { stmts: [], next: index + 1 };
  if (first.t === "name" && first.v === "async" && toks.length > 1) {
    toks = toks.slice(1);
    first = toks[0];
  }
  if (first.t !== "name") return { stmts: parseSimple(toks), next: index + 1 };

  const colon = headerColon(toks, 1);
  switch (first.v) {
    case "def": {
      const name = toks[1]?.t === "name" ? toks[1].v : "_";
      const c = new Cursor(toks.slice(3, colon >= 0 ? colon : toks.length));
      const params = parseParams(c, ")");
      const { body, next } = compoundBody(lines, index, colon);
      return { stmts: [{ k: "def", name, params, body }], next };
    }
    case "class":
    case "while":
    case "except":
    case "finally":
    case "elif":
    case "else":
    case "match":
    case "case": {
      // Not executed: classes are opaque, loops of unknown length and other branches are skipped
      const { next } = compoundBody(lines, index, colon);
      return { stmts: [], next };
    }
    case "for": {
      const header = new Cursor(toks.slice(1, colon >= 0 ? colon : toks.length));
      const target = parseTargetList(header);
      header.eatName("in");
      const iter = parseExprList(header);
      const { body, next } = compoundBody(lines, index, colon);
      return { stmts: [{ k: "for", target, iter, body }], next };
    }
    case "with": {
      const items: [PyExpr, PyExpr | null][] = [];
      for (const part of splitTopLevel(toks.slice(1, colon >= 0 ? colon : toks.length), ",")) {
        const asIndex = part.findIndex((tok) => tok.t === "name" && tok.v === "as");
        const ctx = parseExpr(new Cursor(asIndex >= 0 ? part.slice(0, asIndex) : part));
        items.push([ctx, asIndex >= 0 ? parsePostfix(new Cursor(part.slice(asIndex + 1))) : null]);
      }
      const { body, next } = compoundBody(lines, index, colon);
      return { stmts: [{ k: "with", items, body }], next };
    }
    case "if":
    case "try": {
      // The first branch is run; its alternatives are skipped (handled above)
      const { body, next } = compoundBody(lines, index, colon);
      return { stmts: [{ k: "run", body }], next };
    }
    default:
      return { stmts: parseSimple(toks), next: index + 1 };
  }
}

export function parsePythonProgram(source: string): PyStmt[] {
  const lines = tokenizePython(source);
  const body: PyStmt[] = [];
  let i = 0;
  while (i < lines.length) {
    try {
      const { stmts, next } = parseStatement(lines, i);
      body.push(...stmts);
      i = Math.max(next, i + 1);
    } catch {
      // A pathological statement (e.g. thousands of nested brackets) is skipped alone
      i += 1;
    }
  }
  return body;
}
