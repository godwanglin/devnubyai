import { cmykColor, fontFamilyOf, fontFlagsOf, fontKindOf, normalizeColor, rgbColor } from "../common";
import { DEFAULT_TEXT_STYLE, type DraftTextStyle } from "../types";
import { isObj, obj, toNumber, toText, type PyVal } from "./values";

/** Fonts registered by the script: `TTFont('Body', 'Lato-Regular.ttf')` → Body = Lato regular. */
export type FontRegistry = Map<string, { family: string; bold: boolean; italic: boolean }>;

export const UNIT_REFS: Record<string, number> = { cm: 28.3464567, mm: 2.83464567, inch: 72, pica: 12, point: 1 };

export const PAGE_SIZES: Record<string, [number, number]> = {
  A0: [2383.94, 3370.39], A1: [1683.78, 2383.94], A2: [1190.55, 1683.78], A3: [841.89, 1190.55],
  A4: [595.2756, 841.8898], A5: [419.53, 595.28], A6: [297.64, 419.53], B4: [708.66, 1000.63],
  B5: [498.9, 708.66], letter: [612, 792], LETTER: [612, 792], legal: [612, 1008], LEGAL: [612, 1008],
  tabloid: [792, 1224], ledger: [1224, 792], elevenSeventeen: [792, 1224],
};

export const ALIGN_REFS: Record<string, DraftTextStyle["align"]> = {
  TA_LEFT: "left", TA_CENTER: "center", TA_CENTRE: "center", TA_RIGHT: "right", TA_JUSTIFY: "justify",
};

const ALIGN_BY_NUMBER: DraftTextStyle["align"][] = ["left", "center", "right", "left", "justify"];

/** CSS color of a color-ish value: Color object, '#hex' string, name. */
export function colorOf(value: PyVal | undefined): string | undefined {
  if (!value) return undefined;
  if (isObj(value, "color")) return value.props.css as string | undefined;
  if (value.t === "str") return normalizeColor(value.v);
  if (value.t === "list" && value.items.length >= 3) {
    const [r, g, b] = value.items.map((v) => toNumber(v));
    return rgbColor(r, g, b, r <= 1 && g <= 1 && b <= 1 ? 255 : 1);
  }
  return undefined;
}

export function colorObj(css: string | undefined): PyVal {
  return obj("color", { css });
}

/** `colors.HexColor('#102943')`, `colors.Color(r,g,b)`, `CMYKColor(...)`, `toColor('red')` */
export function makeColor(name: string, args: PyVal[]): PyVal | null {
  switch (name) {
    case "HexColor":
    case "toColor": {
      const first = args[0];
      if (first?.t === "num") return colorObj(normalizeColor(Math.round(first.v).toString(16).padStart(6, "0")));
      return colorObj(colorOf(first));
    }
    case "Color": {
      const [r, g, b] = [0, 1, 2].map((i) => toNumber(args[i]));
      return colorObj(rgbColor(r, g, b, 255));
    }
    case "CMYKColor":
    case "PCMYKColor": {
      const scale = name === "PCMYKColor" ? 100 : 1;
      const [c, m, y, k] = [0, 1, 2, 3].map((i) => toNumber(args[i]) / scale);
      return colorObj(cmykColor(c, m, y, k));
    }
    default:
      return null;
  }
}

export function fontInfo(fontName: string | undefined, registry: FontRegistry): { family?: string; bold: boolean; italic: boolean } {
  if (!fontName) return { family: undefined, bold: false, italic: false };
  const registered = registry.get(fontName);
  if (registered) return registered;
  const flags = fontFlagsOf(fontName);
  return { family: fontFamilyOf(fontName), ...flags };
}

/** A ParagraphStyle object from its constructor arguments (parent styles are merged). */
export function makeParagraphStyle(args: PyVal[], kw: Map<string, PyVal>): PyVal {
  const props: Record<string, unknown> = {};
  const parent = kw.get("parent") ?? args[1];
  if (isObj(parent, "style")) Object.assign(props, parent.props);
  props.name = toText(kw.get("name") ?? args[0]);
  kw.forEach((value, key) => {
    if (key !== "parent" && key !== "name") props[key] = value;
  });
  return obj("style", props);
}

export function styleProp(style: PyVal | undefined, key: string): PyVal | undefined {
  return isObj(style, "style") ? (style.props[key] as PyVal | undefined) : undefined;
}

function alignOf(value: PyVal | undefined): DraftTextStyle["align"] | undefined {
  if (!value) return undefined;
  if (value.t === "num") return ALIGN_BY_NUMBER[value.v] ?? "left";
  if (value.t === "str") {
    const key = value.v.toLowerCase();
    if (key.startsWith("cent")) return "center";
    if (key === "right") return "right";
    if (key === "justify") return "justify";
    return "left";
  }
  return undefined;
}

/** Draft text style of a reportlab style object (defaults: Helvetica 10/12). */
export function resolveTextStyle(style: PyVal | undefined, registry: FontRegistry): DraftTextStyle {
  const get = (key: string) => styleProp(style, key);
  const fontName = get("fontName")?.t === "str" ? toText(get("fontName")) : DEFAULT_TEXT_STYLE.fontName;
  const font = fontInfo(fontName, registry);
  const fontSize = clampSize(toNumber(get("fontSize"), DEFAULT_TEXT_STYLE.fontSize));
  const leading = clampSize(toNumber(get("leading"), fontSize * 1.2), fontSize);
  return {
    fontName: font.family,
    fontKind: fontKindOf(font.family ?? fontName),
    fontSize,
    leading,
    bold: font.bold,
    italic: font.italic,
    align: alignOf(get("alignment")) ?? "left",
    color: colorOf(get("textColor")),
    background: colorOf(get("backColor")),
    spaceBefore: Math.max(0, toNumber(get("spaceBefore"), 0)),
    spaceAfter: Math.max(0, toNumber(get("spaceAfter"), 0)),
    leftIndent: Math.max(0, toNumber(get("leftIndent"), 0)),
    rightIndent: Math.max(0, toNumber(get("rightIndent"), 0)),
    firstLineIndent: toNumber(get("firstLineIndent"), 0),
  };
}

function clampSize(value: number, min = 1): number {
  return Number.isFinite(value) ? Math.min(400, Math.max(min, value)) : min;
}

/** getSampleStyleSheet(): the reportlab defaults, by name. */
export function sampleStyleSheet(): PyVal {
  const make = (name: string, props: Record<string, PyVal>) => obj("style", { name, ...props });
  const n = (v: number): PyVal => ({ t: "num", v });
  const s = (v: string): PyVal => ({ t: "str", v, complete: true });
  const normal = make("Normal", { fontName: s("Helvetica"), fontSize: n(10), leading: n(12) });
  const styles = new Map<string, PyVal>([
    ["Normal", normal],
    ["BodyText", make("BodyText", { fontName: s("Helvetica"), fontSize: n(10), leading: n(12), spaceBefore: n(6) })],
    ["Italic", make("Italic", { fontName: s("Helvetica-Oblique"), fontSize: n(10), leading: n(12) })],
    ["Title", make("Title", { fontName: s("Helvetica-Bold"), fontSize: n(18), leading: n(22), alignment: n(1), spaceAfter: n(6) })],
    ["Heading1", make("Heading1", { fontName: s("Helvetica-Bold"), fontSize: n(18), leading: n(22), spaceAfter: n(6) })],
    ["Heading2", make("Heading2", { fontName: s("Helvetica-Bold"), fontSize: n(14), leading: n(18), spaceBefore: n(12), spaceAfter: n(6) })],
    ["Heading3", make("Heading3", { fontName: s("Helvetica-BoldOblique"), fontSize: n(12), leading: n(14), spaceBefore: n(12), spaceAfter: n(6) })],
    ["Heading4", make("Heading4", { fontName: s("Helvetica-BoldOblique"), fontSize: n(10), leading: n(12), spaceBefore: n(10), spaceAfter: n(4) })],
    ["Bullet", make("Bullet", { fontName: s("Helvetica"), fontSize: n(10), leading: n(12), spaceBefore: n(3) })],
    ["Code", make("Code", { fontName: s("Courier"), fontSize: n(8), leading: n(8.8), leftIndent: n(36) })],
  ]);
  return obj("stylesheet", { styles });
}
