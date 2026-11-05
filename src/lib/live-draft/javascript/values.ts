import type { JsExpr, JsPattern, JsStmt } from "./parser";

export type JsVal =
  | { t: "str"; v: string; complete: boolean }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "nil" }
  | { t: "arr"; items: JsVal[] }
  | { t: "obj"; props: Map<string, JsVal> }
  | { t: "fn"; params: JsPattern[]; body: JsStmt[] | JsExpr; closure: JsScope }
  /** Instance of a library class: `new Paragraph({...})`, a pptx slide… */
  | { t: "inst"; cls: string; args: JsVal[]; state: Record<string, unknown> }
  /** Something imported or global: `docx.Paragraph`, `HeadingLevel.HEADING_1` */
  | { t: "ref"; path: string }
  | { t: "unknown" };

export class JsScope {
  readonly vars = new Map<string, JsVal>();
  constructor(readonly parent: JsScope | null) {}
  get(name: string): JsVal | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }
  /** Assignment to an existing binding up the chain, else a new local one. */
  assign(name: string, value: JsVal): void {
    if (!this.setExisting(name, value)) this.vars.set(name, value);
  }
  private setExisting(name: string, value: JsVal): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return true;
    }
    return this.parent ? this.parent.setExisting(name, value) : false;
  }
  declare(name: string, value: JsVal): void {
    this.vars.set(name, value);
  }
}

export const NIL: JsVal = { t: "nil" };
export const UNKNOWN_JS: JsVal = { t: "unknown" };

export function jsStr(v: string, complete = true): JsVal {
  return { t: "str", v, complete };
}

export function jsNum(v: number): JsVal {
  return { t: "num", v: Number.isFinite(v) ? v : 0 };
}

export function jsText(value: JsVal | undefined): string {
  if (!value) return "";
  switch (value.t) {
    case "str":
      return value.v;
    case "num":
      return Number.isInteger(value.v) ? String(value.v) : String(Math.round(value.v * 1e6) / 1e6);
    case "bool":
      return String(value.v);
    case "arr":
      return value.items.map(jsText).join(",");
    case "nil":
      return "";
    default:
      return "…";
  }
}

export function jsNumber(value: JsVal | undefined, fallback = 0): number {
  if (!value) return fallback;
  if (value.t === "num") return value.v;
  if (value.t === "str") {
    const parsed = parseFloat(value.v);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (value.t === "bool") return value.v ? 1 : 0;
  return fallback;
}

export function jsTruthy(value: JsVal): boolean {
  switch (value.t) {
    case "str":
      return value.v.length > 0;
    case "num":
      return value.v !== 0;
    case "bool":
      return value.v;
    case "nil":
      return false;
    default:
      return true;
  }
}

export function jsIncomplete(value: JsVal | undefined): boolean {
  if (!value) return false;
  if (value.t === "str") return !value.complete;
  if (value.t === "inst") return Boolean(value.state.typing);
  return false;
}

/** Property of a plain object (`opts.get("x")`), undefined when absent. */
export function prop(value: JsVal | undefined, key: string): JsVal | undefined {
  return value?.t === "obj" ? value.props.get(key) : undefined;
}

export function propText(value: JsVal | undefined, key: string): string | undefined {
  const p = prop(value, key);
  return p && (p.t === "str" || p.t === "num") ? jsText(p) : p?.t === "ref" ? p.path.split(".").pop() : undefined;
}

export function propNumber(value: JsVal | undefined, key: string): number | undefined {
  const p = prop(value, key);
  if (!p || (p.t !== "num" && p.t !== "str")) return undefined;
  const n = jsNumber(p, NaN);
  return Number.isFinite(n) ? n : undefined;
}

export function propBool(value: JsVal | undefined, key: string): boolean | undefined {
  const p = prop(value, key);
  return p && p.t !== "unknown" && p.t !== "nil" ? jsTruthy(p) : undefined;
}
