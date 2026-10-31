import { child, childElements, path, type XmlElement } from "./xml";

/**
 * DrawingML helpers shared by the PPTX and DOCX parsers: theme colors, color modifiers
 * (lumMod, tint, shade, alpha...) and fills. Output is CSS color / background strings.
 */

/** Theme palette plus the scheme-name mapping (tx1 → dk1, ...) in effect for a part. */
export interface DrawingColorScheme {
  colors: Map<string, string>;
  clrMap: Record<string, string>;
}

export interface DrawingTheme {
  colors: Map<string, string>;
  majorFont: string | null;
  minorFont: string | null;
}

/** Word and PowerPoint's default mapping when a part doesn't override it. */
export const DEFAULT_CLR_MAP: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };

const PRESET_COLORS: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00",
  gray: "808080", grey: "808080", darkGray: "A9A9A9", lightGray: "D3D3D3", orange: "FFA500",
  navy: "000080", purple: "800080", teal: "008080", silver: "C0C0C0", maroon: "800000",
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.padStart(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue(p, q, h + 1 / 3) * 255),
    Math.round(hue(p, q, h) * 255),
    Math.round(hue(p, q, h - 1 / 3) * 255),
  ];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Resolves a DrawingML color element (srgbClr, schemeClr, ...) with modifiers to CSS. */
export function resolveDrawingColor(
  colorEl: XmlElement | undefined,
  scheme: DrawingColorScheme,
  phColor?: string
): string | null {
  if (!colorEl) return null;
  let hex: string | null = null;

  switch (colorEl.name) {
    case "a:srgbClr":
      hex = colorEl.attrs.val ?? null;
      break;
    case "a:sysClr":
      hex = colorEl.attrs.lastClr ?? (colorEl.attrs.val === "window" ? "FFFFFF" : "000000");
      break;
    case "a:prstClr":
      hex = PRESET_COLORS[colorEl.attrs.val ?? ""] ?? null;
      break;
    case "a:scrgbClr": {
      const pct = (v?: string) => Math.round(clamp01(Number(v ?? 0) / 100000) * 255);
      hex = [pct(colorEl.attrs.r), pct(colorEl.attrs.g), pct(colorEl.attrs.b)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      break;
    }
    case "a:schemeClr": {
      const val = colorEl.attrs.val ?? "";
      if (val === "phClr") {
        hex = phColor?.replace("#", "") ?? null;
      } else {
        const mapped = scheme.clrMap[val] ?? val;
        hex = scheme.colors.get(mapped) ?? null;
      }
      break;
    }
    default:
      return null;
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;

  let rgb = hexToRgb(hex);
  let alpha = 1;
  for (const mod of childElements(colorEl)) {
    const v = Number(mod.attrs.val ?? 0) / 100000;
    switch (mod.name) {
      case "a:lumMod": {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, clamp01(l * v)]);
        break;
      }
      case "a:lumOff": {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, clamp01(l + v)]);
        break;
      }
      case "a:tint":
        rgb = rgb.map((c) => Math.round(c * v + 255 * (1 - v))) as [number, number, number];
        break;
      case "a:shade":
        rgb = rgb.map((c) => Math.round(c * v)) as [number, number, number];
        break;
      case "a:alpha":
        alpha = clamp01(v);
        break;
    }
  }

  if (alpha < 1) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const COLOR_TAGS = new Set(["a:srgbClr", "a:schemeClr", "a:sysClr", "a:prstClr", "a:scrgbClr"]);

export function drawingColorChild(el: XmlElement | undefined): XmlElement | undefined {
  return childElements(el).find((c) => COLOR_TAGS.has(c.name));
}

/**
 * CSS background for a fill-bearing element (spPr, bgPr, tcPr...).
 * Returns undefined when the element doesn't specify a fill, null for "no fill".
 */
export function resolveDrawingFill(
  props: XmlElement | undefined,
  scheme: DrawingColorScheme,
  phColor?: string
): string | null | undefined {
  if (!props) return undefined;
  for (const el of childElements(props)) {
    switch (el.name) {
      case "a:noFill":
        return null;
      case "a:solidFill":
        return resolveDrawingColor(drawingColorChild(el), scheme, phColor);
      case "a:gradFill": {
        const stops = childElements(child(el, "a:gsLst"))
          .map((gs) => ({
            pos: Number(gs.attrs.pos ?? 0) / 1000,
            color: resolveDrawingColor(drawingColorChild(gs), scheme, phColor),
          }))
          .filter((s): s is { pos: number; color: string } => Boolean(s.color))
          .sort((a, b) => a.pos - b.pos);
        if (stops.length === 0) return null;
        if (stops.length === 1) return stops[0].color;
        const lin = child(el, "a:lin");
        // DrawingML angles are clockwise from the x-axis; CSS starts at "to top"
        const angle = lin ? Number(lin.attrs.ang ?? 0) / 60000 + 90 : 180;
        return `linear-gradient(${angle}deg, ${stops.map((s) => `${s.color} ${s.pos}%`).join(", ")})`;
      }
      case "a:pattFill":
        return resolveDrawingColor(drawingColorChild(child(el, "a:fgClr")), scheme, phColor);
      case "a:grpFill":
        return undefined;
    }
  }
  return undefined;
}

/** Palette and major/minor fonts from a theme part (`a:theme`). */
export function parseDrawingTheme(xml: XmlElement | null | undefined): DrawingTheme {
  const theme: DrawingTheme = { colors: new Map(), majorFont: null, minorFont: null };
  const elements = path(xml ?? undefined, "a:theme", "a:themeElements");
  for (const c of childElements(child(elements, "a:clrScheme"))) {
    const colorEl = childElements(c)[0];
    const hex = colorEl?.attrs.val && colorEl.name === "a:srgbClr" ? colorEl.attrs.val : colorEl?.attrs.lastClr;
    if (hex) theme.colors.set(c.name.replace("a:", ""), hex);
  }
  const fontScheme = child(elements, "a:fontScheme");
  theme.majorFont = path(fontScheme, "a:majorFont", "a:latin")?.attrs.typeface || null;
  theme.minorFont = path(fontScheme, "a:minorFont", "a:latin")?.attrs.typeface || null;
  return theme;
}
