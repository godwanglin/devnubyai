import {
  NONE,
  UNKNOWN_VAL,
  dictKey,
  isIncomplete,
  iterItems,
  list,
  num,
  str,
  toNumber,
  toText,
  truthy,
  type PyVal,
} from "./values";

type Call = (fn: PyVal, args: PyVal[]) => PyVal;

function sameText(a: PyVal, b: PyVal): boolean {
  return toText(a) === toText(b);
}

/** `+ - * / // % **` and comparisons over plain values; unknown for anything else. */
export function binaryOp(op: string, left: PyVal, right: PyVal): PyVal {
  if (op === "+") {
    if (left.t === "str" || right.t === "str") {
      if (left.t === "unknown" && right.t === "unknown") return UNKNOWN_VAL;
      return str(toText(left) + toText(right), !isIncomplete(left) && !isIncomplete(right));
    }
    if (left.t === "list" && right.t === "list") return list([...left.items, ...right.items], left.tuple);
    if ((left.t === "num" || left.t === "bool") && (right.t === "num" || right.t === "bool")) return num(toNumber(left) + toNumber(right));
    return UNKNOWN_VAL;
  }
  if (op === "*") {
    if (left.t === "str" && right.t === "num") return str(left.v.repeat(Math.max(0, Math.min(200, right.v))), left.complete);
    if (left.t === "list" && right.t === "num") {
      const out: PyVal[] = [];
      for (let i = 0; i < Math.min(50, right.v); i += 1) out.push(...left.items);
      return list(out);
    }
    if (left.t === "num" && right.t === "num") return num(left.v * right.v);
    if (left.t === "num" && right.t === "list" && right.tuple) {
      // `2.5 * cm` style unit tuples are not a thing; keep numbers numeric
      return UNKNOWN_VAL;
    }
    return UNKNOWN_VAL;
  }
  if (op === "%" && left.t === "str") {
    // printf-style formatting: keep the template, substitute in order
    const values = right.t === "list" ? right.items : [right];
    let index = 0;
    const text = left.v.replace(/%(?:\([^)]*\))?[-#0 +]*\d*(?:\.\d+)?[sdifr%]/g, (m) => (m.endsWith("%") ? "%" : toText(values[index++] ?? UNKNOWN_VAL)));
    return str(text, left.complete);
  }
  const a = left.t === "num" || left.t === "bool" ? toNumber(left) : null;
  const b = right.t === "num" || right.t === "bool" ? toNumber(right) : null;
  switch (op) {
    case "-":
      return a !== null && b !== null ? num(a - b) : UNKNOWN_VAL;
    case "/":
      return a !== null && b !== null && b !== 0 ? num(a / b) : UNKNOWN_VAL;
    case "//":
      return a !== null && b !== null && b !== 0 ? num(Math.floor(a / b)) : UNKNOWN_VAL;
    case "%":
      return a !== null && b !== null && b !== 0 ? num(((a % b) + b) % b) : UNKNOWN_VAL;
    case "**":
      return a !== null && b !== null ? num(a ** Math.min(b, 64)) : UNKNOWN_VAL;
    case "==":
      return { t: "bool", v: left.t === right.t && sameText(left, right) };
    case "!=":
      return { t: "bool", v: !(left.t === right.t && sameText(left, right)) };
    case "<":
      return a !== null && b !== null ? { t: "bool", v: a < b } : UNKNOWN_VAL;
    case ">":
      return a !== null && b !== null ? { t: "bool", v: a > b } : UNKNOWN_VAL;
    case "<=":
      return a !== null && b !== null ? { t: "bool", v: a <= b } : UNKNOWN_VAL;
    case ">=":
      return a !== null && b !== null ? { t: "bool", v: a >= b } : UNKNOWN_VAL;
    case "in": {
      const items = iterItems(right);
      if (right.t === "str") return { t: "bool", v: right.v.includes(toText(left)) };
      return items ? { t: "bool", v: items.some((item) => sameText(item, left)) } : UNKNOWN_VAL;
    }
    default:
      return UNKNOWN_VAL;
  }
}

/** Python builtins the drafts need: len, range, enumerate, zip, str, int, … */
export function callBuiltin(
  name: string,
  args: PyVal[],
  kw: Map<string, PyVal>,
  call: Call,
  onList: (value: PyVal) => void
): PyVal | null {
  const first = args[0] ?? UNKNOWN_VAL;
  switch (name) {
    case "len": {
      const items = iterItems(first);
      return items ? num(items.length) : UNKNOWN_VAL;
    }
    case "range": {
      const nums = args.map((a) => toNumber(a, NaN));
      if (nums.some((n) => !Number.isFinite(n))) return UNKNOWN_VAL;
      const [start, stop, step] = nums.length === 1 ? [0, nums[0], 1] : [nums[0], nums[1], nums[2] ?? 1];
      const out: PyVal[] = [];
      if (step === 0) return list([]);
      for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
        out.push(num(i));
        if (out.length >= 3000) break;
      }
      return list(out);
    }
    case "enumerate": {
      const items = iterItems(first);
      const start = toNumber(args[1] ?? kw.get("start"), 0);
      return items ? list(items.map((item, i) => list([num(i + start), item], true))) : UNKNOWN_VAL;
    }
    case "zip": {
      const columns = args.map(iterItems);
      if (columns.some((c) => !c)) return UNKNOWN_VAL;
      const length = Math.min(...columns.map((c) => c!.length));
      return list(Array.from({ length }, (_, i) => list(columns.map((c) => c![i]), true)));
    }
    case "str":
      return str(args.length ? toText(first) : "", !isIncomplete(first));
    case "int":
      return first.t === "num" ? num(Math.trunc(first.v)) : first.t === "str" && Number.isFinite(parseInt(first.v, 10)) ? num(parseInt(first.v, 10)) : UNKNOWN_VAL;
    case "float":
      return first.t === "num" ? first : first.t === "str" && Number.isFinite(parseFloat(first.v)) ? num(parseFloat(first.v)) : UNKNOWN_VAL;
    case "round":
      return first.t === "num" ? num(Number(first.v.toFixed(Math.max(0, Math.min(10, toNumber(args[1], 0)))))) : UNKNOWN_VAL;
    case "abs":
      return first.t === "num" ? num(Math.abs(first.v)) : UNKNOWN_VAL;
    case "list":
    case "tuple":
    case "sorted":
    case "reversed":
    case "set": {
      const items = args.length ? iterItems(first) : [];
      if (!items) return UNKNOWN_VAL;
      const copy = [...items];
      if (name === "reversed") copy.reverse();
      if (name === "sorted") copy.sort((x, y) => (x.t === "num" && y.t === "num" ? x.v - y.v : toText(x).localeCompare(toText(y))));
      const value = list(copy, name === "tuple");
      onList(value);
      return value;
    }
    case "dict": {
      const map = new Map<string, PyVal>();
      const pairs = args.length ? iterItems(first) : [];
      if (first.t === "dict") first.map.forEach((v, k) => map.set(k, v));
      else pairs?.forEach((pair) => {
        const kv = iterItems(pair);
        if (kv && kv.length >= 2) map.set(dictKey(kv[0]), kv[1]);
      });
      kw.forEach((v, k) => map.set(k, v));
      return { t: "dict", map };
    }
    case "min":
    case "max":
    case "sum": {
      const items = args.length === 1 ? iterItems(first) : args;
      const nums = items?.map((v) => toNumber(v, NaN)).filter(Number.isFinite) ?? [];
      if (nums.length === 0) return UNKNOWN_VAL;
      return num(name === "min" ? Math.min(...nums) : name === "max" ? Math.max(...nums) : nums.reduce((s, v) => s + v, 0));
    }
    case "isinstance":
    case "hasattr":
    case "callable":
    case "bool":
      return name === "bool" ? { t: "bool", v: truthy(first) } : UNKNOWN_VAL;
    case "print":
      return NONE;
    case "map": {
      const items = iterItems(args[1] ?? UNKNOWN_VAL);
      return items ? list(items.map((item) => call(first, [item]))) : UNKNOWN_VAL;
    }
    case "filter":
      return args[1] ?? UNKNOWN_VAL;
    default:
      return null;
  }
}

function formatTemplate(template: string, args: PyVal[], kw: Map<string, PyVal>): string {
  let index = 0;
  return template.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (match, field: string | undefined) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    const key = (field ?? "").split(/[!:]/)[0].trim();
    if (key === "") return toText(args[index++] ?? UNKNOWN_VAL);
    if (/^\d+$/.test(key)) return toText(args[Number(key)] ?? UNKNOWN_VAL);
    return toText(kw.get(key) ?? UNKNOWN_VAL);
  });
}

/** Methods of builtin values: list.append, str.join, dict.get, … */
export function callBuiltinMethod(
  receiver: PyVal,
  name: string,
  args: PyVal[],
  kw: Map<string, PyVal>,
  call: Call
): PyVal | null {
  const first = args[0] ?? UNKNOWN_VAL;
  if (receiver.t === "list") {
    switch (name) {
      case "append":
        receiver.items.push(first);
        return NONE;
      case "extend": {
        const items = iterItems(first);
        if (items) receiver.items.push(...items);
        return NONE;
      }
      case "insert": {
        const at = Math.max(0, Math.min(receiver.items.length, toNumber(first, receiver.items.length)));
        receiver.items.splice(at, 0, args[1] ?? UNKNOWN_VAL);
        return NONE;
      }
      case "pop":
        return receiver.items.pop() ?? UNKNOWN_VAL;
      case "copy":
        return list([...receiver.items], receiver.tuple);
      case "index":
        return num(receiver.items.findIndex((item) => toText(item) === toText(first)));
      default:
        return UNKNOWN_VAL;
    }
  }
  if (receiver.t === "str") {
    const complete = receiver.complete;
    switch (name) {
      case "join": {
        const items = iterItems(first);
        return items ? str(items.map(toText).join(receiver.v), complete && !items.some(isIncomplete)) : UNKNOWN_VAL;
      }
      case "upper":
        return str(receiver.v.toUpperCase(), complete);
      case "lower":
        return str(receiver.v.toLowerCase(), complete);
      case "title":
        return str(receiver.v.replace(/\b\p{L}/gu, (c) => c.toUpperCase()), complete);
      case "capitalize":
        return str(receiver.v.charAt(0).toUpperCase() + receiver.v.slice(1), complete);
      case "strip":
      case "lstrip":
      case "rstrip":
        return str(name === "strip" ? receiver.v.trim() : name === "lstrip" ? receiver.v.trimStart() : receiver.v.trimEnd(), complete);
      case "replace":
        return str(receiver.v.split(toText(first)).join(toText(args[1] ?? str(""))), complete);
      case "format":
        return str(formatTemplate(receiver.v, args, kw), complete && !args.some(isIncomplete));
      case "split": {
        const sep = args.length && first.t === "str" ? first.v : null;
        const parts = sep === null ? receiver.v.trim().split(/\s+/).filter(Boolean) : receiver.v.split(sep);
        return list(parts.map((p) => str(p, complete)));
      }
      case "splitlines":
        return list(receiver.v.split(/\r?\n/).map((p) => str(p, complete)));
      case "startswith":
        return { t: "bool", v: receiver.v.startsWith(toText(first)) };
      case "endswith":
        return { t: "bool", v: receiver.v.endsWith(toText(first)) };
      case "center":
      case "ljust":
      case "rjust":
      case "zfill":
        return receiver;
      default:
        return UNKNOWN_VAL;
    }
  }
  if (receiver.t === "dict") {
    switch (name) {
      case "get":
        return receiver.map.get(dictKey(first)) ?? args[1] ?? NONE;
      case "items":
        return list(Array.from(receiver.map.entries()).map(([k, v]) => list([str(k), v], true)));
      case "keys":
        return list(Array.from(receiver.map.keys()).map((k) => str(k)));
      case "values":
        return list(Array.from(receiver.map.values()));
      case "update":
        if (first.t === "dict") first.map.forEach((v, k) => receiver.map.set(k, v));
        kw.forEach((v, k) => receiver.map.set(k, v));
        return NONE;
      case "setdefault": {
        const key = dictKey(first);
        if (!receiver.map.has(key)) receiver.map.set(key, args[1] ?? NONE);
        return receiver.map.get(key)!;
      }
      default:
        return UNKNOWN_VAL;
    }
  }
  if (receiver.t === "fn" && name === "__call__") return call(receiver, args);
  return null;
}
