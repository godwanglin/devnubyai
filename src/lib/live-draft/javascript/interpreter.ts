import type { JsExpr, JsPattern, JsStmt } from "./parser";
import {
  JsScope,
  NIL,
  UNKNOWN_JS,
  jsIncomplete,
  jsNum,
  jsNumber,
  jsStr,
  jsText,
  jsTruthy,
  type JsVal,
} from "./values";

export interface JsLibrary {
  resolveRef(path: string): JsVal | null;
  construct(path: string, args: JsVal[]): JsVal | null;
  callRef(path: string, args: JsVal[]): JsVal | null;
  callMethod(target: JsVal & { t: "inst" }, name: string, args: JsVal[]): JsVal | null;
  getProp(target: JsVal & { t: "inst" }, name: string): JsVal | null;
  setProp(target: JsVal & { t: "inst" }, name: string, value: JsVal): void;
  onArray(value: JsVal & { t: "arr" }): void;
}

const MAX_ITEMS = 3000;
const MAX_DEPTH = 40;

function last(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1);
}

/** Budgeted evaluator for the JavaScript subset of document scripts; never throws. */
export class JsInterpreter {
  private steps = 0;
  private depth = 0;
  readonly globals = new JsScope(null);

  constructor(
    private readonly lib: JsLibrary,
    private readonly budget = 300_000
  ) {}

  private tick(): boolean {
    this.steps += 1;
    return this.steps <= this.budget;
  }

  run(program: JsStmt[]): void {
    this.execBlock(program, this.globals);
  }

  private execBlock(stmts: JsStmt[], scope: JsScope): { returned?: JsVal } {
    // Function declarations are hoisted
    for (const stmt of stmts) if (stmt.k === "func") scope.declare(stmt.name, { t: "fn", params: stmt.fn.params, body: stmt.fn.body, closure: scope });
    for (const stmt of stmts) {
      if (!this.tick()) return {};
      try {
        const flow = this.execStatement(stmt, scope);
        if (flow.returned) return flow;
      } catch {
        // One statement failing (deep recursion…) leaves the rest of the draft intact
      }
    }
    return {};
  }

  private execStatement(stmt: JsStmt, scope: JsScope): { returned?: JsVal } {
    switch (stmt.k) {
      case "decl":
        this.bind(stmt.pattern, stmt.init ? this.eval(stmt.init, scope) : NIL, scope);
        break;
      case "expr":
        this.eval(stmt.e, scope);
        break;
      case "return":
        return { returned: stmt.e ? this.eval(stmt.e, scope) : NIL };
      case "block": {
        const flow = this.execBlock(stmt.body, new JsScope(scope));
        if (flow.returned) return flow;
        break;
      }
      case "forof": {
        const iterable = this.eval(stmt.iter, scope);
        const items = iterable.t === "arr" ? iterable.items : iterable.t === "str" ? Array.from(iterable.v).map((ch) => jsStr(ch)) : null;
        if (!items) break;
        for (const item of items.slice(0, MAX_ITEMS)) {
          if (this.steps > this.budget) return {};
          const inner = new JsScope(scope);
          this.bind(stmt.pattern, item, inner);
          const flow = this.execBlock(stmt.body, inner);
          if (flow.returned) return flow;
        }
        break;
      }
      default:
        break;
    }
    return {};
  }

  private bind(pattern: JsPattern, value: JsVal, scope: JsScope): void {
    const resolved = value.t === "nil" && "def" in pattern && pattern.def ? this.eval(pattern.def, scope) : value;
    switch (pattern.k) {
      case "id":
        scope.declare(pattern.name, resolved);
        return;
      case "rest":
        this.bind(pattern.pattern, resolved, scope);
        return;
      case "objpat":
        for (const { key, pattern: inner } of pattern.props) {
          const part =
            resolved.t === "obj"
              ? (resolved.props.get(key) ?? NIL)
              : resolved.t === "ref"
                ? (this.lib.resolveRef(`${resolved.path}.${key}`) ?? { t: "ref", path: `${resolved.path}.${key}` })
                : UNKNOWN_JS;
          this.bind(inner, part, scope);
        }
        return;
      case "arrpat":
        pattern.items.forEach((inner, i) => {
          if (inner) this.bind(inner, resolved.t === "arr" ? (resolved.items[i] ?? NIL) : UNKNOWN_JS, scope);
        });
        return;
    }
  }

  private assignTo(target: JsExpr, value: JsVal, scope: JsScope): void {
    if (target.k === "name") {
      scope.assign(target.v, value);
      return;
    }
    if (target.k === "member") {
      const owner = this.eval(target.obj, scope);
      const key = typeof target.prop === "string" ? target.prop : jsText(this.eval(target.prop, scope));
      if (owner.t === "obj") owner.props.set(key, value);
      else if (owner.t === "inst") this.lib.setProp(owner, key, value);
      else if (owner.t === "arr") {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && index < owner.items.length + 1) owner.items[index] = value;
      }
    }
  }

  private evalArgs(args: JsExpr[], scope: JsScope): JsVal[] {
    const out: JsVal[] = [];
    for (const arg of args) {
      if (arg.k === "spread") {
        const spread = this.eval(arg.e, scope);
        if (spread.t === "arr") out.push(...spread.items);
      } else {
        out.push(this.eval(arg, scope));
      }
    }
    return out;
  }

  eval(expr: JsExpr, scope: JsScope): JsVal {
    if (!this.tick()) return UNKNOWN_JS;
    switch (expr.k) {
      case "str":
        return jsStr(expr.v, expr.complete);
      case "num":
        return jsNum(expr.v);
      case "lit":
        return typeof expr.v === "boolean" ? { t: "bool", v: expr.v } : NIL;
      case "tpl": {
        let text = "";
        let complete = expr.complete;
        for (const part of expr.parts) {
          if (typeof part === "string") text += part;
          else {
            const value = this.eval(part, scope);
            if (jsIncomplete(value)) complete = false;
            text += jsText(value);
          }
        }
        return jsStr(text, complete);
      }
      case "name":
        if (expr.v === "require") return { t: "ref", path: "require" };
        return scope.get(expr.v) ?? this.lib.resolveRef(expr.v) ?? { t: "ref", path: expr.v };
      case "member": {
        const owner = this.eval(expr.obj, scope);
        const key = typeof expr.prop === "string" ? expr.prop : jsText(this.eval(expr.prop, scope));
        return this.member(owner, key);
      }
      case "call":
        return this.evalCall(expr, scope);
      case "new": {
        const ctor = this.eval(expr.fn, scope);
        const args = this.evalArgs(expr.args, scope);
        if (ctor.t === "ref") return this.lib.construct(ctor.path, args) ?? { t: "inst", cls: last(ctor.path), args, state: {} };
        return UNKNOWN_JS;
      }
      case "arr": {
        const value: JsVal & { t: "arr" } = { t: "arr", items: this.evalArgs(expr.items, scope) };
        this.lib.onArray(value);
        return value;
      }
      case "obj": {
        const props = new Map<string, JsVal>();
        for (const entry of expr.props) {
          if ("spread" in entry) {
            const spread = this.eval(entry.spread, scope);
            if (spread.t === "obj") spread.props.forEach((v, k) => props.set(k, v));
          } else {
            const key = typeof entry.key === "string" ? entry.key : jsText(this.eval(entry.key, scope));
            props.set(key, this.eval(entry.value, scope));
          }
        }
        return { t: "obj", props };
      }
      case "fn":
        return { t: "fn", params: expr.params, body: expr.body, closure: scope };
      case "assign": {
        const value = this.eval(expr.value, scope);
        if (expr.op === "=") {
          this.assignTo(expr.target, value, scope);
          return value;
        }
        const current = this.eval(expr.target, scope);
        const combined = expr.op === "+=" ? this.binary("+", current, value) : value;
        this.assignTo(expr.target, combined, scope);
        return combined;
      }
      case "cond": {
        const test = this.eval(expr.test, scope);
        return test.t === "unknown" || test.t === "ref" || jsTruthy(test) ? this.eval(expr.a, scope) : this.eval(expr.b, scope);
      }
      case "bin": {
        if (expr.op === "&&") {
          const l = this.eval(expr.l, scope);
          return jsTruthy(l) ? this.eval(expr.r, scope) : l;
        }
        if (expr.op === "||" || expr.op === "??") {
          const l = this.eval(expr.l, scope);
          const keep = expr.op === "||" ? jsTruthy(l) : l.t !== "nil";
          return keep ? l : this.eval(expr.r, scope);
        }
        return this.binary(expr.op, this.eval(expr.l, scope), this.eval(expr.r, scope));
      }
      case "un": {
        const value = this.eval(expr.e, scope);
        if (expr.op === "!") return { t: "bool", v: !jsTruthy(value) };
        if (expr.op === "-") return jsNum(-jsNumber(value));
        return value;
      }
      case "spread":
        return this.eval(expr.e, scope);
      default:
        return UNKNOWN_JS;
    }
  }

  private binary(op: string, l: JsVal, r: JsVal): JsVal {
    if (op === "+") {
      if (l.t === "str" || r.t === "str") return jsStr(jsText(l) + jsText(r), !jsIncomplete(l) && !jsIncomplete(r));
      if (l.t === "num" && r.t === "num") return jsNum(l.v + r.v);
      return UNKNOWN_JS;
    }
    const a = l.t === "num" ? l.v : null;
    const b = r.t === "num" ? r.v : null;
    if (a === null || b === null) return op === "===" || op === "==" ? { t: "bool", v: jsText(l) === jsText(r) } : UNKNOWN_JS;
    switch (op) {
      case "-":
        return jsNum(a - b);
      case "*":
        return jsNum(a * b);
      case "/":
        return b === 0 ? UNKNOWN_JS : jsNum(a / b);
      case "%":
        return b === 0 ? UNKNOWN_JS : jsNum(a % b);
      case "**":
        return jsNum(a ** Math.min(b, 64));
      case "<":
        return { t: "bool", v: a < b };
      case ">":
        return { t: "bool", v: a > b };
      case "<=":
        return { t: "bool", v: a <= b };
      case ">=":
        return { t: "bool", v: a >= b };
      case "==":
      case "===":
        return { t: "bool", v: a === b };
      case "!=":
      case "!==":
        return { t: "bool", v: a !== b };
      default:
        return UNKNOWN_JS;
    }
  }

  private member(owner: JsVal, key: string): JsVal {
    if (owner.t === "ref") {
      const path = `${owner.path}.${key}`;
      return this.lib.resolveRef(path) ?? { t: "ref", path };
    }
    if (owner.t === "obj") return owner.props.get(key) ?? NIL;
    if (owner.t === "inst") return this.lib.getProp(owner, key) ?? UNKNOWN_JS;
    if (owner.t === "arr") {
      if (key === "length") return jsNum(owner.items.length);
      const index = Number(key);
      return Number.isInteger(index) ? (owner.items[index] ?? NIL) : UNKNOWN_JS;
    }
    if (owner.t === "str" && key === "length") return jsNum(owner.v.length);
    return UNKNOWN_JS;
  }

  callFn(fn: JsVal, args: JsVal[]): JsVal {
    if (fn.t !== "fn" || this.depth >= MAX_DEPTH || this.steps > this.budget) return UNKNOWN_JS;
    const local = new JsScope(fn.closure);
    fn.params.forEach((param, i) => {
      if (param.k === "rest") this.bind(param.pattern, { t: "arr", items: args.slice(i) }, local);
      else this.bind(param, args[i] ?? NIL, local);
    });
    this.depth += 1;
    try {
      if (!Array.isArray(fn.body)) return this.eval(fn.body, local);
      return this.execBlock(fn.body, local).returned ?? NIL;
    } finally {
      this.depth -= 1;
    }
  }

  private evalCall(expr: Extract<JsExpr, { k: "call" }>, scope: JsScope): JsVal {
    if (expr.fn.k === "member") {
      const receiver = this.eval(expr.fn.obj, scope);
      const name = typeof expr.fn.prop === "string" ? expr.fn.prop : jsText(this.eval(expr.fn.prop, scope));
      const args = this.evalArgs(expr.args, scope);
      if (receiver.t === "ref") return this.lib.callRef(`${receiver.path}.${name}`, args) ?? this.builtinRef(`${receiver.path}.${name}`, args);
      if (receiver.t === "inst") return this.lib.callMethod(receiver, name, args) ?? UNKNOWN_JS;
      if (receiver.t === "obj") {
        const method = receiver.props.get(name);
        return method ? this.callFn(method, args) : UNKNOWN_JS;
      }
      return this.builtinMethod(receiver, name, args);
    }
    const fn = this.eval(expr.fn, scope);
    const args = this.evalArgs(expr.args, scope);
    if (fn.t === "ref") {
      if (fn.path === "require") return { t: "ref", path: jsText(args[0]) };
      return this.lib.callRef(fn.path, args) ?? this.builtinRef(fn.path, args);
    }
    return this.callFn(fn, args);
  }

  private builtinRef(path: string, args: JsVal[]): JsVal {
    const first = args[0] ?? UNKNOWN_JS;
    switch (path) {
      case "String":
        return jsStr(jsText(first), !jsIncomplete(first));
      case "Number":
      case "parseFloat":
      case "parseInt":
        return jsNum(jsNumber(first));
      case "Math.max":
      case "Math.min":
        return jsNum((path === "Math.max" ? Math.max : Math.min)(...args.map((a) => jsNumber(a))));
      case "Math.round":
      case "Math.floor":
      case "Math.ceil":
        return jsNum(Math[path.slice(5) as "round" | "floor" | "ceil"](jsNumber(first)));
      case "Array.from": {
        if (first.t === "arr") return { t: "arr", items: [...first.items] };
        const length = Math.min(MAX_ITEMS, jsNumber(first.t === "obj" ? (first.props.get("length") ?? NIL) : NIL));
        const mapFn = args[1];
        const items = Array.from({ length }, (_, i) => (mapFn ? this.callFn(mapFn, [NIL, jsNum(i)]) : NIL));
        return { t: "arr", items };
      }
      case "Object.entries":
        return first.t === "obj" ? { t: "arr", items: Array.from(first.props.entries()).map(([k, v]) => ({ t: "arr", items: [jsStr(k), v] }) as JsVal) } : UNKNOWN_JS;
      case "Object.keys":
        return first.t === "obj" ? { t: "arr", items: Array.from(first.props.keys()).map((k) => jsStr(k)) } : UNKNOWN_JS;
      case "Object.values":
        return first.t === "obj" ? { t: "arr", items: Array.from(first.props.values()) } : UNKNOWN_JS;
      case "Object.assign": {
        if (first.t !== "obj") return first;
        for (const extra of args.slice(1)) if (extra.t === "obj") extra.props.forEach((v, k) => first.props.set(k, v));
        return first;
      }
      default:
        return UNKNOWN_JS;
    }
  }

  private builtinMethod(receiver: JsVal, name: string, args: JsVal[]): JsVal {
    const first = args[0] ?? UNKNOWN_JS;
    if (receiver.t === "arr") {
      switch (name) {
        case "push":
          receiver.items.push(...args);
          return jsNum(receiver.items.length);
        case "unshift":
          receiver.items.unshift(...args);
          return jsNum(receiver.items.length);
        case "concat": {
          const out: JsVal & { t: "arr" } = { t: "arr", items: [...receiver.items] };
          for (const a of args) out.items.push(...(a.t === "arr" ? a.items : [a]));
          this.lib.onArray(out);
          return out;
        }
        case "map":
        case "flatMap": {
          const out: JsVal & { t: "arr" } = { t: "arr", items: [] };
          receiver.items.slice(0, MAX_ITEMS).forEach((item, i) => {
            const mapped = this.callFn(first, [item, jsNum(i)]);
            if (name === "flatMap" && mapped.t === "arr") out.items.push(...mapped.items);
            else out.items.push(mapped);
          });
          this.lib.onArray(out);
          return out;
        }
        case "forEach":
          receiver.items.slice(0, MAX_ITEMS).forEach((item, i) => this.callFn(first, [item, jsNum(i)]));
          return NIL;
        case "filter": {
          const out: JsVal & { t: "arr" } = {
            t: "arr",
            items: receiver.items.filter((item, i) => {
              const keep = this.callFn(first, [item, jsNum(i)]);
              return keep.t === "unknown" || jsTruthy(keep);
            }),
          };
          this.lib.onArray(out);
          return out;
        }
        case "flat":
          return { t: "arr", items: receiver.items.flatMap((item) => (item.t === "arr" ? item.items : [item])) };
        case "slice":
          return { t: "arr", items: receiver.items.slice(jsNumber(first, 0), args[1] ? jsNumber(args[1]) : undefined) };
        case "join":
          return jsStr(receiver.items.map(jsText).join(args.length ? jsText(first) : ","), !receiver.items.some(jsIncomplete));
        case "includes":
          return { t: "bool", v: receiver.items.some((item) => jsText(item) === jsText(first)) };
        default:
          return UNKNOWN_JS;
      }
    }
    if (receiver.t === "str") {
      const done = (v: string) => jsStr(v, receiver.complete);
      switch (name) {
        case "toUpperCase":
          return done(receiver.v.toUpperCase());
        case "toLowerCase":
          return done(receiver.v.toLowerCase());
        case "trim":
          return done(receiver.v.trim());
        case "replace":
        case "replaceAll":
          return first.t === "str" ? done(receiver.v.split(first.v).join(jsText(args[1]))) : receiver;
        case "split":
          return { t: "arr", items: receiver.v.split(jsText(first)).map((part) => done(part)) };
        case "repeat":
          return done(receiver.v.repeat(Math.max(0, Math.min(200, jsNumber(first)))));
        case "padStart":
        case "padEnd":
        case "toString":
          return receiver;
        case "slice":
        case "substring":
          return done(receiver.v.slice(jsNumber(first, 0), args[1] ? jsNumber(args[1]) : undefined));
        case "concat":
          return jsStr(receiver.v + args.map(jsText).join(""), receiver.complete && !args.some(jsIncomplete));
        case "includes":
          return { t: "bool", v: receiver.v.includes(jsText(first)) };
        case "startsWith":
          return { t: "bool", v: receiver.v.startsWith(jsText(first)) };
        default:
          return UNKNOWN_JS;
      }
    }
    if (receiver.t === "num" && name === "toFixed") return jsStr(receiver.v.toFixed(Math.max(0, Math.min(10, jsNumber(first)))));
    if (receiver.t === "fn" && (name === "call" || name === "apply")) return this.callFn(receiver, args.slice(1));
    return UNKNOWN_JS;
  }
}
