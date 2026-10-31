/**
 * Converts internal tool parameter schemas into strict, 100% compliant JSON Schema Draft-07
 * accepted by OpenAI, DeepSeek, Anthropic, and other upstream providers.
 *
 * In JSON Schema:
 * - `required` MUST be an array of strings on the object schema (`required: ["query"]`).
 * - Properties must NOT contain `required: true` (which causes `true is not of type "array"` on DeepSeek).
 */
export function sanitizeParametersSchema(
  schema: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }

  const result: Record<string, unknown> = {
    type: schema.type || "object",
  };

  const collectedRequired: string[] = Array.isArray(schema.required)
    ? [...schema.required]
    : [];

  if (schema.properties && typeof schema.properties === "object") {
    const rawProps = schema.properties as Record<string, unknown>;
    const cleanProps: Record<string, unknown> = {};

    for (const [key, rawVal] of Object.entries(rawProps)) {
      if (rawVal && typeof rawVal === "object") {
        const propObj = { ...(rawVal as Record<string, unknown>) };

        // If author wrote `required: true` on the property, move it to the parent required array
        if (propObj.required === true) {
          if (!collectedRequired.includes(key)) {
            collectedRequired.push(key);
          }
          delete propObj.required;
        } else if (propObj.required === false) {
          delete propObj.required;
        }

        // Clean nested items for arrays
        if (propObj.items && typeof propObj.items === "object") {
          propObj.items = sanitizeParametersSchema(
            propObj.items as Record<string, unknown>
          );
        }

        // Clean nested properties for objects
        if (propObj.properties && typeof propObj.properties === "object") {
          const nested = sanitizeParametersSchema(propObj);
          propObj.properties = nested.properties;
          if (Array.isArray(nested.required) && nested.required.length > 0) {
            propObj.required = nested.required;
          }
        }

        cleanProps[key] = propObj;
      } else {
        cleanProps[key] = rawVal;
      }
    }

    result.properties = cleanProps;
  } else {
    result.properties = {};
  }

  if (collectedRequired.length > 0) {
    result.required = collectedRequired;
  }

  return result;
}
