import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface CalculateParams {
  expression: string;
}

export interface CalculateData {
  expression: string;
  result: string;
  precision: number;
}

/**
 * Safe arithmetic evaluator. Supports + - * / % ^ ( ) and standard math
 * functions (sin, cos, tan, sqrt, log, abs, min, max, round, floor, ceil, pow).
 * NO eval / Function — parsed by a small recursive-descent parser to avoid
 * code injection. No access to process, fs, network, or globals.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = input.replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      tokens.push(s.slice(i, j));
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z_0-9]/.test(s[j])) j++;
      tokens.push(s.slice(i, j));
      i = j;
      continue;
    }
    if ("+-*/%^() ,".includes(c)) {
      tokens.push(c);
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${c}'`);
  }
  return tokens;
}

const MATH_FUNCS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  log: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

class Parser {
  private pos = 0;
  constructor(private tokens: string[]) {}
  parse(): number {
    const v = this.expr();
    if (this.pos !== this.tokens.length) throw new Error("Unexpected token");
    if (!Number.isFinite(v)) throw new Error("Result is not finite");
    return v;
  }
  private expr(): number {
    let v = this.term();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.next();
      const r = this.term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  private term(): number {
    let v = this.factor();
    while (this.peek() === "*" || this.peek() === "/" || this.peek() === "%") {
      const op = this.next();
      const r = this.factor();
      if (op === "*") v *= r;
      else if (op === "/") {
        if (r === 0) throw new Error("Division by zero");
        v /= r;
      } else v %= r;
    }
    return v;
  }
  private factor(): number {
    let v = this.unary();
    if (this.peek() === "^") {
      this.next();
      const r = this.factor();
      v = Math.pow(v, r);
    }
    return v;
  }
  private unary(): number {
    if (this.peek() === "-") {
      this.next();
      return -this.unary();
    }
    if (this.peek() === "+") {
      this.next();
      return this.unary();
    }
    return this.primary();
  }
  private primary(): number {
    const t = this.peek();
    if (t === undefined) throw new Error("Unexpected end of expression");
    if (t === "(") {
      this.next();
      const v = this.expr();
      if (this.next() !== ")") throw new Error("Missing closing parenthesis");
      return v;
    }
    if (/^[0-9]/.test(t) || t === ".") {
      this.next();
      const n = Number(t);
      if (Number.isNaN(n)) throw new Error(`Invalid number '${t}'`);
      return n;
    }
    if (/^[a-zA-Z_]/.test(t)) {
      this.next();
      // function call?
      if (this.peek() === "(") {
        const fn = MATH_FUNCS[t.toLowerCase()];
        if (!fn) throw new Error(`Unknown function '${t}'`);
        this.next();
        const args: number[] = [];
        if (this.peek() !== ")") {
          args.push(this.expr());
          while (this.peek() === ",") {
            this.next();
            args.push(this.expr());
          }
        }
        if (this.next() !== ")") throw new Error("Missing closing parenthesis");
        const r = fn(...args);
        if (!Number.isFinite(r)) throw new Error("Function result is not finite");
        return r;
      }
      throw new Error(`Unknown identifier '${t}'`);
    }
    throw new Error(`Unexpected token '${t}'`);
  }
  private peek(): string | undefined {
    return this.tokens[this.pos];
  }
  private next(): string {
    return this.tokens[this.pos++];
  }
}

export function safeEvaluate(expression: string): number {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error("Empty expression");
  return new Parser(tokens).parse();
}

export const calculateTool: ToolDefinition<CalculateParams, CalculateData> = {
  name: "calculate",
  description:
    "Evaluates a mathematical expression safely and returns the exact numeric result. Use for arithmetic, percentages, ratios, statistics, unit conversions, and any precise calculation. Supports + - * / % ^ ( ), and functions: sin, cos, tan, asin, acos, atan, sqrt, abs, log, log10, exp, floor, ceil, round, min, max, pow. No code execution, no access to system.",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description:
          "The mathematical expression to evaluate, e.g. '(12.5 * 8) / 3 + sqrt(16)'.",
        required: true,
      },
    },
    required: ["expression"],
  },
  execute: async (
    params: CalculateParams,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult<CalculateData>> => {
    const startTime = Date.now();
    const expression = String(params?.expression ?? "").trim();
    if (!expression) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Parameter 'expression' cannot be empty." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
    if (expression.length > 2000) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Expression exceeds maximum length of 2000 characters." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
    try {
      const result = safeEvaluate(expression);
      return {
        success: true,
        data: {
          expression,
          result: String(result),
          precision: 15,
        },
        metadata: { durationMs: Date.now() - startTime, provider: "safe-math-parser" },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid expression";
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: `Could not evaluate expression: ${message}` },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
