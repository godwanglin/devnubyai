/**
 * Minimal SSE parser for upstream gateway responses.
 * Yields one record per event block: `{ event, data }`. Comment lines (":") are skipped.
 */
export interface SseRecord {
  event: string | null;
  data: string;
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseRecord> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | null = null;
  let dataLines: string[] = [];

  const flush = (): SseRecord | null => {
    if (dataLines.length === 0) {
      event = null;
      return null;
    }
    const record = { event, data: dataLines.join("\n") };
    event = null;
    dataLines = [];
    return record;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (line === "") {
          const record = flush();
          if (record) yield record;
          continue;
        }
        if (line.startsWith(":")) continue;

        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);

        if (field === "event") event = value;
        else if (field === "data") dataLines.push(value);
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      const line = buffer.replace(/\r$/, "");
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      else if (line.startsWith("event:")) event = line.slice(6).trim();
    }
    const last = flush();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
