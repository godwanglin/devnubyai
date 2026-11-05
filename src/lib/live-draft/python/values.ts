import type { PyParam, PyStmt } from "./parser";

/** Runtime values of the draft interpreter. Library objects are `obj` with a class tag. */
export type PyVal =
  | { t: "str"; v: string; complete: boolean }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "none" }
  | { t: "list"; items: PyVal[]; tuple?: boolean }
  | { t: "dict"; map: Map<string, PyVal> }
  | { t: "fn"; name: string; params: PyParam[]; body: PyStmt[] | null; lambdaBody?: unknown; closure: Scope }
  | { t: "obj"; cls: string; props: Record<string, unknown> }
  /** A name the code did not define (an import): `colors.HexColor`, `A4`, `Paragraph` */
  | { t: "ref"; path: string }
  | { t: "unknown"; incomplete?: boolean };

export class Scope {
  readonly vars = new Map<string, PyVal>();
  constructor(readonly parent: Scope | null) {}
  get(name: string): PyVal | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }
  set(name: string, value: PyVal): void {
    this.vars.set(name, value);
  }
}

export const NONE: PyVal = { t: "none" };
export const UNKNOWN_VAL: PyVal = { t: "unknown" };

export function str(v: string, complete = true): PyVal {
  return { t: "str", v, complete };
}

export function num(v: number): PyVal {
  return { t: "num", v: Number.isFinite(v) ? v : 0 };
}

export function list(items: PyVal[], tuple = false): PyVal {
  return { t: "list", items, tuple };
}

export function obj(cls: string, props: Record<string, unknown> = {}): PyVal & { t: "obj" } {
  return { t: "obj", cls, props };
}

export function isObj(value: PyVal | undefined, cls?: string): value is PyVal & { t: "obj" } {
  return value?.t === "obj" && (cls === undefined || value.cls === cls);
}

export function toNumber(value: PyVal | undefined, fallback = 0): number {
  if (!value) return fallback;
  if (value.t === "num") return value.v;
  if (value.t === "bool") return value.v ? 1 : 0;
  if (value.t === "str") {
    const parsed = parseFloat(value.v);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Text of a value as Python's `str()` would show it ("…" where it cannot be known). */
export function toText(value: PyVal | undefined): string {
  if (!value) return "";
  switch (value.t) {
    case "str":
      return value.v;
    case "num":
      return Number.isInteger(value.v) ? String(value.v) : String(Math.round(value.v * 1e6) / 1e6);
    case "bool":
      return value.v ? "True" : "False";
    case "none":
      return "None";
    case "list":
      return value.items.map(toText).join(", ");
    case "obj":
      return typeof value.props.text === "string" ? value.props.text : "";
    default:
      return "…";
  }
}

export function isIncomplete(value: PyVal | undefined): boolean {
  if (!value) return false;
  if (value.t === "str") return !value.complete;
  if (value.t === "unknown") return Boolean(value.incomplete);
  if (value.t === "obj") return Boolean(value.props.typing);
  return false;
}

export function truthy(value: PyVal): boolean {
  switch (value.t) {
    case "str":
      return value.v.length > 0;
    case "num":
      return value.v !== 0;
    case "bool":
      return value.v;
    case "none":
      return false;
    case "list":
      return value.items.length > 0;
    case "dict":
      return value.map.size > 0;
    default:
      return true;
  }
}

/** Items to iterate over (lists, tuples, strings, dict keys); null when unknown. */
export function iterItems(value: PyVal): PyVal[] | null {
  if (value.t === "list") return value.items;
  if (value.t === "str") return Array.from(value.v).map((ch) => str(ch));
  if (value.t === "dict") return Array.from(value.map.keys()).map((k) => str(k));
  return null;
}

export function dictKey(value: PyVal): string {
  return value.t === "str" ? value.v : toText(value);
}
