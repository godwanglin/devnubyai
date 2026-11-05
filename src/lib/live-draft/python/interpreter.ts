import type { FPart, PyExpr, PyParam, PyStmt } from "./parser";
import { callBuiltinMethod, callBuiltin, binaryOp } from "./builtins";
import {
  NONE,
  Scope,
  UNKNOWN_VAL,
  dictKey,
  isIncomplete,
  iterItems,
  list,
  num,
  str,
  toText,
  truthy,
  type PyVal,
} from "./values";

/** What a library (reportlab, openpyxl…) adds to the interpreter. */
export interface PyLibrary {
  /** Value of an imported name (`A4`, `cm`, `colors.red`); null when not a known constant */
  resolveRef(path: string): PyVal | null;
  /** Call of an imported callable (`Paragraph(...)`, `colors.HexColor(...)`) */
  callRef(path: string, args: PyVal[], kw: Map<string, PyVal>): PyVal | null;
  callMethod(target: PyVal & { t: "obj" }, name: string, args: PyVal[], kw: Map<string, PyVal>): PyVal | null;
  getAttr(target: PyVal & { t: "obj" }, name: string): PyVal | null;
  setAttr(target: PyVal & { t: "obj" }, name: string, value: PyVal): void;
  getItem(target: PyVal & { t: "obj" }, key: PyVal): PyVal | null;
  setItem(target: PyVal & { t: "obj" }, key: PyVal, value: PyVal): void;
  /** Every list literal the program builds (story candidates) */
  onList(value: PyVal & { t: "list" }): void;
}

interface Flow {
  returned?: PyVal;
}

const MAX_LOOP_ITEMS = 3000;
const MAX_DEPTH = 40;

/**
 * Runs the parsed program over plain values with a step budget. It never throws: what
 * cannot be known (I/O, unknown APIs, other branches) becomes `unknown` and is skipped.
 */
export class PyInterpreter {
  private steps = 0;
  private depth = 0;
  readonly globals = new Scope(null);
  /** Top-level functions the program defined, in order, and whether they ran */
  readonly definedFunctions: { name: string; value: PyVal & { t: "fn" }; called: boolean }[] = [];

  constructor(
    private readonly lib: PyLibrary,
    private readonly budget = 300_000
  ) {}

  get exhausted(): boolean {
    return this.steps > this.budget;
  }

  run(program: PyStmt[]): void {
    this.execBlock(program, this.globals);
  }

  /** Calls functions the code defined but has not reached a call for yet (`main()` at the end). */
  runUncalledEntryPoints(): void {
    for (const entry of this.definedFunctions) {
      if (entry.called || this.exhausted) continue;
      const required = entry.value.params.filter((p) => !p.def && !p.star);
      if (required.length > 0) continue;
      this.callValue(entry.value, [], new Map());
    }
  }

  private tick(): boolean {
    this.steps += 1;
    return this.steps <= this.budget;
  }

  execBlock(stmts: PyStmt[], scope: Scope): Flow {
    for (const stmt of stmts) {
      if (!this.tick()) return {};
      let flow: Flow = {};
      try {
        flow = this.exec(stmt, scope);
      } catch {
        // One statement failing (deep recursion…) leaves the rest of the draft intact
        continue;
      }
      if (flow.returned) return flow;
    }
    return {};
  }

  private exec(stmt: PyStmt, scope: Scope): Flow {
    switch (stmt.k) {
      case "expr":
        this.eval(stmt.e, scope);
        return {};
      case "assign": {
        const value = this.eval(stmt.value, scope);
        for (const target of stmt.targets) this.assign(target, value, scope);
        return {};
      }
      case "aug": {
        const current = this.eval(stmt.target, scope);
        const value = this.eval(stmt.value, scope);
        if (stmt.op === "+=" && current.t === "list") {
          const items = iterItems(value);
          if (items) current.items.push(...items);
          return {};
        }
        this.assign(stmt.target, binaryOp(stmt.op.slice(0, -1), current, value), scope);
        return {};
      }
      case "def": {
        const fn: PyVal & { t: "fn" } = { t: "fn", name: stmt.name, params: stmt.params, body: stmt.body, closure: scope };
        scope.set(stmt.name, fn);
        if (scope === this.globals) this.definedFunctions.push({ name: stmt.name, value: fn, called: false });
        return {};
      }
      case "for": {
        const iterable = this.eval(stmt.iter, scope);
        const items = iterItems(iterable);
        if (!items) return {};
        for (const item of items.slice(0, MAX_LOOP_ITEMS)) {
          if (this.exhausted) return {};
          this.assign(stmt.target, item, scope);
          const flow = this.execBlock(stmt.body, scope);
          if (flow.returned) return flow;
        }
        return {};
      }
      case "with": {
        for (const [ctx, target] of stmt.items) {
          const value = this.eval(ctx, scope);
          if (target) this.assign(target, value, scope);
        }
        return this.execBlock(stmt.body, scope);
      }
      case "run":
        return this.execBlock(stmt.body, scope);
      case "return":
        return { returned: stmt.e ? this.eval(stmt.e, scope) : NONE };
      default:
        return {};
    }
  }

  private assign(target: PyExpr, value: PyVal, scope: Scope): void {
    switch (target.k) {
      case "name":
        scope.set(target.v, value);
        return;
      case "tuple":
      case "list": {
        const items = iterItems(value);
        target.items.forEach((item, index) => {
          if (item.k === "star") this.assign(item.e, list(items ? items.slice(index) : []), scope);
          else this.assign(item, items?.[index] ?? UNKNOWN_VAL, scope);
        });
        return;
      }
      case "attr": {
        const owner = this.eval(target.obj, scope);
        if (owner.t === "obj") this.lib.setAttr(owner, target.name, value);
        return;
      }
      case "sub": {
        const owner = this.eval(target.obj, scope);
        const key = this.eval(target.index, scope);
        if (owner.t === "obj") this.lib.setItem(owner, key, value);
        else if (owner.t === "dict") owner.map.set(dictKey(key), value);
        else if (owner.t === "list" && key.t === "num") {
          const index = key.v < 0 ? owner.items.length + key.v : key.v;
          if (index >= 0 && index < owner.items.length) owner.items[index] = value;
        }
        return;
      }
      default:
        return;
    }
  }

  private evalFString(parts: FPart[], complete: boolean, scope: Scope): PyVal {
    let text = "";
    let incomplete = !complete;
    for (const part of parts) {
      if (typeof part === "string") {
        text += part;
      } else {
        const value = this.eval(part.expr, scope);
        if (isIncomplete(value)) incomplete = true;
        text += toText(value);
      }
    }
    return str(text, !incomplete);
  }

  eval(expr: PyExpr, scope: Scope): PyVal {
    if (!this.tick()) return UNKNOWN_VAL;
    switch (expr.k) {
      case "str":
        return expr.fparts ? this.evalFString(expr.fparts, expr.complete, scope) : str(expr.v, expr.complete);
      case "num":
        return num(expr.v);
      case "const":
        return expr.v === null ? NONE : { t: "bool", v: expr.v };
      case "name":
        return scope.get(expr.v) ?? this.lib.resolveRef(expr.v) ?? { t: "ref", path: expr.v };
      case "attr": {
        const owner = this.eval(expr.obj, scope);
        if (owner.t === "ref") {
          const path = `${owner.path}.${expr.name}`;
          return this.lib.resolveRef(path) ?? { t: "ref", path };
        }
        if (owner.t === "obj") return this.lib.getAttr(owner, expr.name) ?? UNKNOWN_VAL;
        return UNKNOWN_VAL;
      }
      case "call":
        return this.evalCall(expr, scope);
      case "sub": {
        const owner = this.eval(expr.obj, scope);
        if (expr.index.k === "slice") return owner.t === "list" ? list([...owner.items], owner.tuple) : owner.t === "str" ? owner : UNKNOWN_VAL;
        const key = this.eval(expr.index, scope);
        if (owner.t === "list" && key.t === "num") {
          const index = key.v < 0 ? owner.items.length + key.v : key.v;
          return owner.items[index] ?? UNKNOWN_VAL;
        }
        if (owner.t === "dict") return owner.map.get(dictKey(key)) ?? UNKNOWN_VAL;
        if (owner.t === "str" && key.t === "num") return str(owner.v.at(key.v) ?? "");
        if (owner.t === "obj") return this.lib.getItem(owner, key) ?? UNKNOWN_VAL;
        return UNKNOWN_VAL;
      }
      case "list":
      case "tuple":
      case "set": {
        const items: PyVal[] = [];
        for (const item of expr.items) {
          if (item.k === "star") {
            const spread = iterItems(this.eval(item.e, scope));
            if (spread) items.push(...spread);
          } else {
            items.push(this.eval(item, scope));
          }
        }
        const value = list(items, expr.k === "tuple") as PyVal & { t: "list" };
        if (expr.k === "list") this.lib.onList(value);
        return value;
      }
      case "dict": {
        const map = new Map<string, PyVal>();
        for (const [k, v] of expr.entries) map.set(dictKey(this.eval(k, scope)), this.eval(v, scope));
        return { t: "dict", map };
      }
      case "bin": {
        if (expr.op === "and") {
          const left = this.eval(expr.l, scope);
          return truthy(left) ? this.eval(expr.r, scope) : left;
        }
        if (expr.op === "or") {
          const left = this.eval(expr.l, scope);
          return truthy(left) ? left : this.eval(expr.r, scope);
        }
        return binaryOp(expr.op, this.eval(expr.l, scope), this.eval(expr.r, scope));
      }
      case "un": {
        const value = this.eval(expr.e, scope);
        if (expr.op === "not") return { t: "bool", v: !truthy(value) };
        if (expr.op === "-" && value.t === "num") return num(-value.v);
        return value;
      }
      case "ifexp": {
        const cond = this.eval(expr.cond, scope);
        return cond.t === "unknown" || cond.t === "ref" || truthy(cond) ? this.eval(expr.body, scope) : this.eval(expr.orelse, scope);
      }
      case "comp":
        return this.evalComprehension(expr, scope);
      case "lambda":
        return { t: "fn", name: "<lambda>", params: expr.params, body: null, lambdaBody: expr.body, closure: scope };
      case "star":
        return this.eval(expr.e, scope);
      default:
        return UNKNOWN_VAL;
    }
  }

  private evalComprehension(expr: Extract<PyExpr, { k: "comp" }>, scope: Scope): PyVal {
    const items = iterItems(this.eval(expr.iter, scope));
    if (!items) return expr.kind === "dict" ? { t: "dict", map: new Map() } : list([]);
    const inner = new Scope(scope);
    const out: PyVal[] = [];
    const map = new Map<string, PyVal>();
    for (const item of items.slice(0, MAX_LOOP_ITEMS)) {
      if (this.exhausted) break;
      this.assign(expr.target, item, inner);
      if (expr.cond) {
        const cond = this.eval(expr.cond, inner);
        if (cond.t !== "unknown" && !truthy(cond)) continue;
      }
      if (expr.kind === "dict" && expr.value) map.set(dictKey(this.eval(expr.elt, inner)), this.eval(expr.value, inner));
      else out.push(this.eval(expr.elt, inner));
    }
    if (expr.kind === "dict") return { t: "dict", map };
    const value = list(out) as PyVal & { t: "list" };
    this.lib.onList(value);
    return value;
  }

  private evalArgs(expr: Extract<PyExpr, { k: "call" }>, scope: Scope): { args: PyVal[]; kw: Map<string, PyVal> } {
    const args: PyVal[] = [];
    const kw = new Map<string, PyVal>();
    for (const arg of expr.args) {
      if (arg.k === "star") {
        const value = this.eval(arg.e, scope);
        if (arg.double && value.t === "dict") value.map.forEach((v, k) => kw.set(k, v));
        else args.push(...(iterItems(value) ?? []));
      } else {
        args.push(this.eval(arg, scope));
      }
    }
    for (const [name, value] of expr.kw) kw.set(name, this.eval(value, scope));
    return { args, kw };
  }

  private evalCall(expr: Extract<PyExpr, { k: "call" }>, scope: Scope): PyVal {
    // Method call: evaluate the receiver once
    if (expr.fn.k === "attr") {
      const receiver = this.eval(expr.fn.obj, scope);
      const name = expr.fn.name;
      const { args, kw } = this.evalArgs(expr, scope);
      if (receiver.t === "ref") {
        const path = `${receiver.path}.${name}`;
        return this.lib.callRef(path, args, kw) ?? UNKNOWN_VAL;
      }
      if (receiver.t === "obj") {
        const viaLib = this.lib.callMethod(receiver, name, args, kw);
        if (viaLib) return viaLib;
        const attrValue = this.lib.getAttr(receiver, name);
        return attrValue ? this.callValue(attrValue, args, kw) : UNKNOWN_VAL;
      }
      return callBuiltinMethod(receiver, name, args, kw, (fn, fnArgs) => this.callValue(fn, fnArgs, new Map())) ?? UNKNOWN_VAL;
    }

    const fn = this.eval(expr.fn, scope);
    const { args, kw } = this.evalArgs(expr, scope);
    if (fn.t === "ref") {
      return (
        this.lib.callRef(fn.path, args, kw) ??
        callBuiltin(fn.path, args, kw, (f, fArgs) => this.callValue(f, fArgs, new Map()), (v) => {
          if (v.t === "list") this.lib.onList(v);
        }) ??
        UNKNOWN_VAL
      );
    }
    return this.callValue(fn, args, kw);
  }

  callValue(fn: PyVal, args: PyVal[], kw: Map<string, PyVal>): PyVal {
    if (fn.t !== "fn" || this.depth >= MAX_DEPTH || this.exhausted) return UNKNOWN_VAL;
    const entry = this.definedFunctions.find((d) => d.value === fn);
    if (entry) entry.called = true;
    const local = new Scope(fn.closure);
    this.bindParams(fn.params, args, kw, local, fn.closure);
    this.depth += 1;
    try {
      if (fn.body === null) return this.eval(fn.lambdaBody as PyExpr, local);
      return this.execBlock(fn.body, local).returned ?? NONE;
    } finally {
      this.depth -= 1;
    }
  }

  private bindParams(params: PyParam[], args: PyVal[], kw: Map<string, PyVal>, local: Scope, defScope: Scope): void {
    let index = 0;
    for (const param of params) {
      if (param.star === "*") {
        local.set(param.name, list(args.slice(index), true));
        index = args.length;
      } else if (param.star === "**") {
        local.set(param.name, { t: "dict", map: new Map(kw) });
      } else if (index < args.length) {
        local.set(param.name, args[index]);
        index += 1;
      } else if (kw.has(param.name)) {
        local.set(param.name, kw.get(param.name)!);
      } else {
        local.set(param.name, param.def ? this.eval(param.def, defScope) : UNKNOWN_VAL);
      }
    }
  }
}
