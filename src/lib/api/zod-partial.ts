import { z } from "zod";

type WithoutDefault<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;

/**
 * `.partial()` for PATCH schemas. Zod 4 still applies `.default()` inside
 * optional fields, so a plain `.partial()` would silently reset every omitted
 * field to its create-time default; this unwraps the defaults first.
 */
export function partialUpdate<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ])
  ) as { [K in keyof Shape]: WithoutDefault<Shape[K]> };
  return z.object(shape).partial();
}
