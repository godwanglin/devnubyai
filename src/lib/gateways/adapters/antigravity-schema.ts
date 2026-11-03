/**
 * JSON Schema cleanup for Google Cloud Code Assist (Antigravity) function declarations.
 * Gemini's schema proto rejects the whole request on any unknown keyword, so tool
 * parameter schemas are reduced to the subset it understands.
 */

const UNSUPPORTED_KEYWORDS = new Set([
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "format", "multipleOf", "uniqueItems", "contains",
  "unevaluatedProperties", "unevaluatedItems", "contentSchema",
  "prefixItems", "additionalItems", "default", "examples",
  "$schema", "$defs", "definitions", "const", "$ref", "$comment", "$id",
  "deprecated", "readOnly", "writeOnly",
  "additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
  "anyOf", "oneOf", "allOf", "not",
  "dependencies", "dependentSchemas", "dependentRequired",
  "title", "optional", "if", "then", "else", "contentMediaType", "contentEncoding",
  "errorMessage", "errorMessages", "markdownDescription", "minProperties", "maxProperties",
]);

type Schema = Record<string, unknown>;

const PLACEHOLDER_PROPERTIES = {
  reason: { type: "string", description: "Brief explanation of why you are calling this tool" },
};

function isSchema(value: unknown): value is Schema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Prefer object > array > scalar when collapsing a union; null variants are dropped. */
function pickBestVariant(variants: unknown[]): Schema | null {
  let best: Schema | null = null;
  let bestScore = -1;
  for (const v of variants) {
    if (!isSchema(v) || v.type === "null") continue;
    const score = v.type === "object" || v.properties ? 3 : v.type === "array" || v.items ? 2 : v.type ? 1 : 0;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

function cleanNode(input: unknown): Schema {
  if (!isSchema(input)) return { type: "string" };
  const node: Schema = { ...input };

  // Unions: Gemini has no anyOf/oneOf, keep the richest variant
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(node[key])) {
      const best = pickBestVariant(node[key] as unknown[]);
      delete node[key];
      if (best) Object.assign(node, { ...best, ...node, type: best.type ?? node.type });
    }
  }

  // allOf: merge object members
  if (Array.isArray(node.allOf)) {
    const merged: Schema = {};
    const required: string[] = [];
    for (const part of node.allOf as unknown[]) {
      if (!isSchema(part)) continue;
      if (isSchema(part.properties)) merged.properties = { ...(merged.properties as Schema), ...part.properties };
      if (Array.isArray(part.required)) required.push(...(part.required as string[]));
      if (part.type && !merged.type) merged.type = part.type;
    }
    delete node.allOf;
    if (merged.properties) node.properties = { ...(merged.properties as Schema), ...(node.properties as Schema) };
    if (required.length) node.required = [...new Set([...((node.required as string[]) ?? []), ...required])];
    if (merged.type && !node.type) node.type = merged.type;
  }

  if (node.const !== undefined && !node.enum) node.enum = [node.const];

  // ["string", "null"] -> "string"
  if (Array.isArray(node.type)) {
    const nonNull = (node.type as unknown[]).filter((t) => t !== "null");
    node.type = typeof nonNull[0] === "string" ? nonNull[0] : "string";
  }

  if (Array.isArray(node.enum)) {
    node.enum = (node.enum as unknown[]).map((v) => String(v));
    node.type = "string";
  }

  if (node.properties && !node.type) node.type = "object";

  // Drop unsupported keywords at THIS level only; property names are never touched
  for (const key of Object.keys(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key) || key.startsWith("x-")) delete node[key];
  }

  if (isSchema(node.properties)) {
    const props: Schema = {};
    for (const [name, child] of Object.entries(node.properties)) props[name] = cleanNode(child);
    node.properties = props;
  }

  if (node.type === "array") {
    node.items = Array.isArray(node.items) ? cleanNode(pickBestVariant(node.items)) : cleanNode(node.items ?? { type: "string" });
  } else {
    delete node.items;
  }

  if (node.type === "object") {
    if (!isSchema(node.properties) || Object.keys(node.properties).length === 0) {
      node.properties = { ...PLACEHOLDER_PROPERTIES };
      node.required = ["reason"];
    }
    if (Array.isArray(node.required)) {
      const props = node.properties as Schema;
      const valid = (node.required as unknown[]).filter((r): r is string => typeof r === "string" && r in props);
      if (valid.length) node.required = valid;
      else delete node.required;
    }
  } else {
    delete node.required;
  }

  if (!node.type) node.type = "string";
  return node;
}

export function cleanJSONSchemaForAntigravity(schema: unknown): Schema {
  const source = isSchema(schema) && Object.keys(schema).length > 0 ? schema : { type: "object" };
  const cleaned = cleanNode(source);
  if (cleaned.type !== "object") {
    return { type: "object", properties: { ...PLACEHOLDER_PROPERTIES }, required: ["reason"] };
  }
  return cleaned;
}

/** Gemini function names: [a-zA-Z_][a-zA-Z0-9_.:-]{0,63} */
export function sanitizeGeminiFunctionName(name: string): string {
  if (!name) return "_unknown";
  let s = name.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = `_${s}`;
  return s.slice(0, 64);
}
