import { formatTimestamp, parseTimestamp } from "./detect";

/**
 * Turns a subtitle track into `[m:ss] text` lines the model can quote with timestamps.
 * Cues are merged into ~15 second groups so a long video stays compact. The full
 * transcript is built once (and cached on disk); each `fetch_url` call returns a slice
 * that fits its character budget, with `nextStartAt` to read on from.
 */

export interface TranscriptSlice {
  /** `[m:ss] text` lines, one per ~15s group */
  text: string;
  /** Seconds the first returned line starts at */
  fromSeconds: number;
  /** Seconds to pass as `startAt` to read the rest; null when nothing remains */
  nextStartAt: number | null;
  truncated: boolean;
}

interface Cue {
  start: number;
  /** The cue's caption lines, cleaned */
  lines: string[];
}

const GROUP_SECONDS = 15;

/** One VTT cue's text: inline tags gone, line breaks flattened, HTML entities decoded. */
function cueText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.replace(/^﻿/, "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("NOTE"));
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const stamp = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,]\d+/.exec(lines[timing].trim());
    if (!stamp) continue;
    const start = Number(stamp[1] ?? 0) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]);
    const cueLines = lines.slice(timing + 1).map(cueText).filter(Boolean);
    if (cueLines.length) cues.push({ start, lines: cueLines });
  }
  return cues;
}

/**
 * YouTube auto-captions roll: every cue repeats the line before it (and a 10ms cue
 * repeats the whole pair), so each phrase would appear two or three times. Keeps a line
 * only when it is not one of the last few lines already taken.
 */
function rollingCueTexts(cues: Cue[]): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  const recent: string[] = [];
  for (const cue of cues) {
    const fresh = cue.lines.filter((line) => !recent.includes(line));
    for (const line of fresh) {
      recent.push(line);
      if (recent.length > 3) recent.shift();
    }
    if (fresh.length) out.push({ start: cue.start, text: fresh.join(" ") });
  }
  return out;
}

/**
 * The whole transcript as `[m:ss] text` lines, ~15 seconds per line. `rolling` is for
 * auto-captions; manual subtitles are kept as written (a chorus may really repeat).
 */
export function buildTranscript(vtt: string, rolling: boolean): string {
  const cues = parseVtt(vtt);
  const texts = rolling
    ? rollingCueTexts(cues)
    : cues.map((c) => ({ start: c.start, text: c.lines.join(" ") }));
  const groups: { start: number; texts: string[] }[] = [];
  for (const cue of texts) {
    const current = groups[groups.length - 1];
    if (!current || cue.start - current.start >= GROUP_SECONDS) {
      groups.push({ start: cue.start, texts: [cue.text] });
    } else {
      current.texts.push(cue.text);
    }
  }
  return groups.map((g) => `[${formatTimestamp(g.start)}] ${g.texts.join(" ")}`).join("\n");
}

function lineStart(line: string): number {
  const match = /^\[([\d:]+)\]/.exec(line);
  return (match && parseTimestamp(match[1])) ?? 0;
}

/** The lines from `startAtSeconds` on that fit in `maxChars`. */
export function sliceTranscript(full: string, startAtSeconds: number, maxChars: number): TranscriptSlice {
  const lines = full ? full.split("\n").filter((l) => lineStart(l) >= startAtSeconds) : [];
  const picked: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (picked.length > 0 && used + line.length + 1 > maxChars) break;
    picked.push(line);
    used += line.length + 1;
  }
  const truncated = picked.length < lines.length;
  return {
    text: picked.join("\n"),
    fromSeconds: picked.length ? lineStart(picked[0]) : startAtSeconds,
    nextStartAt: truncated ? lineStart(lines[picked.length]) : null,
    truncated,
  };
}
