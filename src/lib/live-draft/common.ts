import type { FontKind, InlineNode } from "./types";

// ── Fonts ──────────────────────────────────────────────────────────────────

const SERIF_HINTS = ["times", "georgia", "serif", "garamond", "cambria", "caladea", "palatino", "book antiqua", "minion", "merriweather", "playfair", "lora", "baskerville"];
const MONO_HINTS = ["courier", "mono", "consolas", "menlo", "code", "andale"];

export function fontKindOf(name: string | undefined): FontKind {
  const key = (name ?? "").toLowerCase();
  if (MONO_HINTS.some((h) => key.includes(h))) return "mono";
  if (SERIF_HINTS.some((h) => key.includes(h)) && !key.includes("sans")) return "serif";
  return "sans";
}

/** Bold / italic implied by a font or file name (`Times-BoldItalic`, `Lato-Bold.ttf`, `arialbi`). */
export function fontFlagsOf(name: string | undefined): { bold: boolean; italic: boolean } {
  const key = (name ?? "").toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|-b\b|bd\b/.test(key),
    italic: /italic|oblique|-i\b|-bi\b/.test(key),
  };
}

/** Family part of a font or file name: `Lato-BoldItalic.ttf` → `Lato`, `Times-Roman` → `Times`. */
const WINDOWS_FONT_FILES: Record<string, string> = {
  arial: "Arial", times: "Times New Roman", cour: "Courier New", georgia: "Georgia",
  verdana: "Verdana", trebuc: "Trebuchet MS", comic: "Comic Sans MS", calibri: "Calibri",
  cambria: "Cambria", tahoma: "Tahoma", segoeui: "Segoe UI", consola: "Consolas",
};

export function fontFamilyOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.split(/[\\/]/).pop() ?? name;
  const stem = base.replace(/\.(?:ttf|otf|ttc)$/i, "");
  // Windows file names: arialbd, timesbi, georgiaz, couri
  const windows = /^([a-z]+?)(?:bd|bi|i|z|b)?$/.exec(stem);
  if (windows && WINDOWS_FONT_FILES[windows[1]]) return WINDOWS_FONT_FILES[windows[1]];
  if (WINDOWS_FONT_FILES[stem.toLowerCase()]) return WINDOWS_FONT_FILES[stem.toLowerCase()];
  // "Times New Roman-Bold": "Roman" is part of the family name here
  const newRoman = /^(.*new roman)(?:[-_ ].*)?$/i.exec(stem);
  if (newRoman) return newRoman[1].replace(/_/g, " ");
  const family = stem
    .replace(/[-_ ]?(?:Regular|Roman|Bold|Italic|Oblique|Medium|Light|SemiBold|Black|Heavy|Book)+$/i, "")
    .replace(/_/g, " ")
    .trim();
  return family || stem;
}

const KIND_STACK: Record<FontKind, string> = {
  serif: '"Times New Roman", Tinos, "Liberation Serif", Times, serif',
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  mono: '"Courier New", Cousine, "Liberation Mono", monospace',
};

const KNOWN_ALIASES: Record<string, string> = {
  helvetica: "Helvetica, Arial",
  times: '"Times New Roman", Times',
  "times-roman": '"Times New Roman", Times',
  courier: '"Courier New", Courier',
};

/** CSS font-family for a font name, falling back on the matching generic stack. */
export function cssFontFamily(name: string | undefined, kind: FontKind): string {
  const family = fontFamilyOf(name);
  if (!family) return KIND_STACK[kind];
  const alias = KNOWN_ALIASES[family.toLowerCase()];
  const first = alias ?? `"${family.replace(/["\\]/g, "")}"`;
  return `${first}, ${KIND_STACK[kind]}`;
}

// ── Colors ─────────────────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", brown: "#a52a2a",
  grey: "#808080", gray: "#808080", lightgrey: "#d3d3d3", lightgray: "#d3d3d3",
  darkgrey: "#a9a9a9", darkgray: "#a9a9a9", silver: "#c0c0c0", navy: "#000080",
  darkblue: "#00008b", lightblue: "#add8e6", skyblue: "#87ceeb", teal: "#008080",
  darkgreen: "#006400", lightgreen: "#90ee90", maroon: "#800000", darkred: "#8b0000",
  gold: "#ffd700", beige: "#f5f5dc", ivory: "#fffff0", whitesmoke: "#f5f5f5",
  aliceblue: "#f0f8ff", lavender: "#e6e6fa", cyan: "#00ffff", magenta: "#ff00ff",
  olive: "#808000", coral: "#ff7f50", salmon: "#fa8072", tan: "#d2b48c", khaki: "#f0e68c",
  steelblue: "#4682b4", slategray: "#708090", slategrey: "#708090", dimgray: "#696969",
  dimgrey: "#696969", indigo: "#4b0082", crimson: "#dc143c", firebrick: "#b22222",
  transparent: "transparent",
};

/** A safe CSS color from `#abc`, `abcdef`, `rgb(...)` or a color name; undefined otherwise. */
export function normalizeColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  const hex = value.replace(/^#|^0x/i, "");
  if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  const named = NAMED_COLORS[value.toLowerCase()];
  if (named) return named;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (rgb) return rgb[4] !== undefined ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${Number(rgb[4])})` : `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`;
  return undefined;
}

export function rgbColor(r: number, g: number, b: number, scale = 1): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round((Number.isFinite(v) ? v : 0) * scale)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export function cmykColor(c: number, m: number, y: number, k: number): string {
  const to = (v: number) => 255 * (1 - Math.min(1, v)) * (1 - Math.min(1, k));
  return rgbColor(to(c), to(m), to(y));
}

// ── Inline markup (reportlab Paragraph mini-HTML) ─────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", bull: "•", middot: "·", mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", deg: "°", times: "×" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/**
 * reportlab's paragraph markup (`<b>`, `<i>`, `<u>`, `<strike>`, `<super>`, `<sub>`,
 * `<font color size face>`, `<br/>`, `<a>`, entities) as inline nodes. Unknown tags are
 * dropped and their text kept; an unfinished tag at the end (still streaming) is hidden.
 */
export function parseInlineMarkup(source: string): InlineNode[] {
  const root: InlineNode & { kind: "span" } = { kind: "span", children: [] };
  const stack: (InlineNode & { kind: "span" })[] = [root];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)([^<>]*?)(\/?)>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const top = () => stack[stack.length - 1];
  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw.replace(/\s*\n\s*/g, " "));
    if (text) top().children.push({ kind: "text", text });
  };

  while ((match = tagRe.exec(source)) !== null) {
    pushText(source.slice(last, match.index));
    last = tagRe.lastIndex;
    const [, closing, rawName, attrs, selfClosing] = match;
    const name = rawName.toLowerCase();
    if (name === "br") {
      top().children.push({ kind: "br" });
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if ((stack[i] as { tagName?: string }).tagName === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (selfClosing) continue;
    const span: InlineNode & { kind: "span"; tagName?: string } = { kind: "span", children: [], tagName: name };
    switch (name) {
      case "b":
      case "strong":
        span.bold = true;
        break;
      case "i":
      case "em":
        span.italic = true;
        break;
      case "u":
      case "a":
        span.underline = true;
        break;
      case "strike":
      case "s":
      case "del":
        span.strike = true;
        break;
      case "super":
      case "sup":
        span.script = "sup";
        break;
      case "sub":
        span.script = "sub";
        break;
      case "font":
      case "span": {
        span.color = normalizeColor(attr(attrs, "color") ?? attr(attrs, "fontcolor"));
        const size = Number(attr(attrs, "size") ?? attr(attrs, "fontsize"));
        if (Number.isFinite(size) && size > 0 && size < 200) span.fontSize = size;
        const face = attr(attrs, "face") ?? attr(attrs, "name") ?? attr(attrs, "fontname");
        if (face) {
          span.fontFamily = face;
          const flags = fontFlagsOf(face);
          if (flags.bold) span.bold = true;
          if (flags.italic) span.italic = true;
        }
        span.background = normalizeColor(attr(attrs, "backcolor") ?? attr(attrs, "bgcolor"));
        break;
      }
      default:
        break;
    }
    top().children.push(span);
    stack.push(span);
  }

  // A tag still being typed (`<fo`) is not shown as text
  const tail = source.slice(last);
  const open = tail.lastIndexOf("<");
  pushText(open >= 0 && !tail.slice(open).includes(">") ? tail.slice(0, open) : tail);
  return root.children;
}

export function plainInline(text: string): InlineNode[] {
  return text ? [{ kind: "text", text }] : [];
}

/** Plain text of inline nodes (for measuring, searching, empty checks). */
export function inlineText(nodes: InlineNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") out += node.text;
    else if (node.kind === "br") out += "\n";
    else out += inlineText(node.children);
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
