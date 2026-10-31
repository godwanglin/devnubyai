import { child, childElements, findAll, findFirst, localName, textContent, type XmlElement } from "./xml";

/**
 * DrawingML chart (ppt/charts/chartN.xml) → render-ready model.
 * Covers pie, doughnut, bar/column (clustered, stacked, 100%), line, area and scatter
 * charts with their cached data, colors, data labels, legend, title and axes.
 * Text sizes are in points, matching the slide coordinate system.
 */

export type PptxChartType = "pie" | "doughnut" | "bar" | "line" | "area" | "scatter";

export interface PptxChartTextStyle {
  size: number;
  color: string;
  bold: boolean;
  font: string | null;
}

export interface PptxChartLabels {
  showValue: boolean;
  showPercent: boolean;
  showCategory: boolean;
  showSeries: boolean;
  position: string | null;
  format: string | null;
  style: PptxChartTextStyle;
}

export interface PptxChartSeries {
  name: string;
  /** Fill for bars/slices/areas, stroke for lines */
  color: string;
  pointColors: (string | null)[];
  values: number[];
  /** Scatter x values */
  xValues: number[] | null;
  labels: PptxChartLabels | null;
  marker: boolean;
}

export interface PptxChartGroup {
  type: PptxChartType;
  horizontal: boolean;
  grouping: "clustered" | "stacked" | "percentStacked" | "standard";
  gapWidth: number;
  overlap: number;
  varyColors: boolean;
  holeSize: number;
  firstSliceAngle: number;
  series: PptxChartSeries[];
}

export interface PptxChartAxis {
  visible: boolean;
  style: PptxChartTextStyle;
  gridlines: boolean;
  format: string | null;
  min: number | null;
  max: number | null;
}

export interface PptxChart {
  groups: PptxChartGroup[];
  categories: string[];
  title: { text: string; style: PptxChartTextStyle } | null;
  legend: { position: "r" | "l" | "t" | "b" | "tr"; style: PptxChartTextStyle; entries: { label: string; color: string }[] } | null;
  /** Manual inner plot-area layout as fractions of the chart box */
  plotArea: { x: number; y: number; w: number; h: number } | null;
  categoryAxis: PptxChartAxis | null;
  valueAxis: PptxChartAxis | null;
  background: string | null;
}

/** Theme-aware color resolution supplied by the slide parser. */
export interface ChartColorResolver {
  /** CSS fill for a spPr-like element; undefined = unspecified, null = no fill */
  fill: (props: XmlElement | undefined) => string | null | undefined;
  /** CSS color of the first color child of a fill element (solidFill, ...) */
  color: (fillEl: XmlElement | undefined) => string | null;
  accent: (index: number) => string;
  textColor: string;
  font: string | null;
}

const isOn = (el: XmlElement | undefined, fallback = false) =>
  el ? el.attrs.val !== "0" && el.attrs.val !== "false" : fallback;

function cChild(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return childElements(el).find((c) => localName(c.name) === name.toLowerCase());
}

function numAttr(el: XmlElement | undefined, fallback: number): number {
  const v = Number(el?.attrs.val);
  return Number.isFinite(v) ? v : fallback;
}

function textStyleFrom(txPr: XmlElement | undefined, base: PptxChartTextStyle, colors: ChartColorResolver): PptxChartTextStyle {
  const defRPr =
    findFirst(txPr, (el) => el.name === "a:defRPr") ?? findFirst(txPr, (el) => el.name === "a:rPr");
  if (!defRPr) return base;
  const fill = child(defRPr, "a:solidFill");
  return {
    size: defRPr.attrs.sz ? Number(defRPr.attrs.sz) / 100 : base.size,
    bold: defRPr.attrs.b !== undefined ? defRPr.attrs.b === "1" : base.bold,
    color: (fill ? colors.color(fill) : null) ?? base.color,
    font: child(defRPr, "a:latin")?.attrs.typeface ?? base.font,
  };
}

/** Values of a c:val / c:cat / c:xVal / c:yVal reference, honoring ptCount and idx. */
function cachedPoints(ref: XmlElement | undefined): string[] {
  const cache = findFirst(ref, (el) => ["numcache", "strcache", "numlit", "strlit"].includes(localName(el.name)));
  if (!cache) {
    // Multi-level categories: take the innermost level
    const lvl = findFirst(ref, (el) => localName(el.name) === "lvl");
    if (!lvl) return [];
    return childElements(lvl)
      .filter((p) => localName(p.name) === "pt")
      .map((p) => textContent(cChild(p, "v")));
  }
  const count = numAttr(cChild(cache, "ptCount"), 0);
  const out: string[] = new Array(count).fill("");
  for (const pt of childElements(cache)) {
    if (localName(pt.name) !== "pt") continue;
    const idx = Number(pt.attrs.idx ?? out.length);
    out[idx] = textContent(cChild(pt, "v"));
  }
  return out;
}

function parseLabels(
  dLbls: XmlElement | undefined,
  base: PptxChartTextStyle,
  colors: ChartColorResolver
): PptxChartLabels | null {
  if (!dLbls) return null;
  if (isOn(cChild(dLbls, "delete"))) return null;
  // Group-level flags, falling back to the first per-point dLbl
  const source =
    ["showVal", "showPercent", "showCatName", "showSerName"].some((n) => cChild(dLbls, n))
      ? dLbls
      : childElements(dLbls).find((c) => localName(c.name) === "dlbl") ?? dLbls;
  const labels: PptxChartLabels = {
    showValue: isOn(cChild(source, "showVal")),
    showPercent: isOn(cChild(source, "showPercent")),
    showCategory: isOn(cChild(source, "showCatName")),
    showSeries: isOn(cChild(source, "showSerName")),
    position: cChild(source, "dLblPos")?.attrs.val ?? cChild(dLbls, "dLblPos")?.attrs.val ?? null,
    format: cChild(source, "numFmt")?.attrs.formatCode ?? cChild(dLbls, "numFmt")?.attrs.formatCode ?? null,
    style: textStyleFrom(cChild(source, "txPr") ?? cChild(dLbls, "txPr"), base, colors),
  };
  return labels.showValue || labels.showPercent || labels.showCategory || labels.showSeries ? labels : null;
}

function parseAxis(axis: XmlElement | undefined, base: PptxChartTextStyle, colors: ChartColorResolver): PptxChartAxis | null {
  if (!axis) return null;
  const scaling = cChild(axis, "scaling");
  const min = cChild(scaling, "min");
  const max = cChild(scaling, "max");
  return {
    visible: !isOn(cChild(axis, "delete")),
    style: textStyleFrom(cChild(axis, "txPr"), base, colors),
    gridlines: Boolean(cChild(axis, "majorGridlines")),
    format: cChild(axis, "numFmt")?.attrs.formatCode ?? null,
    min: min ? numAttr(min, 0) : null,
    max: max ? numAttr(max, 0) : null,
  };
}

const TYPE_BY_ELEMENT: Record<string, PptxChartType> = {
  piechart: "pie",
  pie3dchart: "pie",
  ofpiechart: "pie",
  doughnutchart: "doughnut",
  barchart: "bar",
  bar3dchart: "bar",
  linechart: "line",
  line3dchart: "line",
  stockchart: "line",
  radarchart: "line",
  areachart: "area",
  area3dchart: "area",
  scatterchart: "scatter",
  bubblechart: "scatter",
};

export function parseChartXml(xml: XmlElement, colors: ChartColorResolver): PptxChart | null {
  const space = childElements(xml).find((el) => localName(el.name) === "chartspace");
  const chart = cChild(space, "chart");
  const plotArea = cChild(chart, "plotArea");
  if (!plotArea) return null;

  const baseStyle = textStyleFrom(cChild(space, "txPr"), {
    size: 12,
    color: colors.textColor,
    bold: false,
    font: colors.font,
  }, colors);

  let categories: string[] = [];
  let seriesCounter = 0;
  const groups: PptxChartGroup[] = [];

  for (const groupEl of childElements(plotArea)) {
    const type = TYPE_BY_ELEMENT[localName(groupEl.name)];
    if (!type) continue;

    const varyColorsEl = cChild(groupEl, "varyColors");
    // Spec default for varyColors is true; PowerPoint writes it explicitly almost always
    const varyColors = varyColorsEl ? isOn(varyColorsEl) : type === "pie" || type === "doughnut";
    const groupLabels = parseLabels(cChild(groupEl, "dLbls"), baseStyle, colors);
    const groupingVal = cChild(groupEl, "grouping")?.attrs.val ?? (type === "bar" ? "clustered" : "standard");

    const series: PptxChartSeries[] = [];
    for (const ser of childElements(groupEl)) {
      if (localName(ser.name) !== "ser") continue;
      const seriesIndex = seriesCounter++;

      const tx = cChild(ser, "tx");
      const name = cachedPoints(tx)[0] || textContent(cChild(tx, "v")) || `Series ${seriesIndex + 1}`;

      const valRef = cChild(ser, "val") ?? cChild(ser, "yVal");
      const values = cachedPoints(valRef).map((v) => (v === "" ? NaN : Number(v)));
      const xRef = type === "scatter" ? cChild(ser, "xVal") : null;
      const xValues = xRef ? cachedPoints(xRef).map(Number) : null;

      if (categories.length === 0) {
        categories = cachedPoints(cChild(ser, "cat") ?? cChild(ser, "xVal"));
      }

      const spPr = cChild(ser, "spPr");
      const isLine = type === "line" || type === "scatter";
      const lineFill = colors.fill(child(spPr, "a:ln"));
      const shapeFill = colors.fill(spPr);
      const color =
        (isLine ? lineFill ?? shapeFill : shapeFill ?? lineFill) ?? colors.accent(seriesIndex);

      const pointColors: (string | null)[] = new Array(values.length).fill(null);
      for (const dPt of childElements(ser)) {
        if (localName(dPt.name) !== "dpt") continue;
        const idx = numAttr(cChild(dPt, "idx"), -1);
        if (idx < 0) continue;
        const ptFill = colors.fill(cChild(dPt, "spPr"));
        if (ptFill) pointColors[idx] = ptFill;
      }

      const markerSymbol = cChild(cChild(ser, "marker"), "symbol")?.attrs.val;

      series.push({
        name,
        color: color ?? "#4472c4",
        pointColors,
        values,
        xValues,
        labels: parseLabels(cChild(ser, "dLbls"), baseStyle, colors) ?? groupLabels,
        marker: type === "scatter" ? markerSymbol !== "none" : Boolean(markerSymbol && markerSymbol !== "none"),
      });
    }
    if (series.length === 0) continue;

    groups.push({
      type,
      horizontal: cChild(groupEl, "barDir")?.attrs.val === "bar",
      grouping:
        groupingVal === "stacked" ? "stacked" : groupingVal === "percentStacked" ? "percentStacked" : groupingVal === "clustered" ? "clustered" : "standard",
      gapWidth: numAttr(cChild(groupEl, "gapWidth"), 150),
      overlap: numAttr(cChild(groupEl, "overlap"), groupingVal === "stacked" || groupingVal === "percentStacked" ? 100 : 0),
      varyColors,
      holeSize: numAttr(cChild(groupEl, "holeSize"), 50),
      firstSliceAngle: numAttr(cChild(groupEl, "firstSliceAng"), 0),
      series,
    });
  }

  if (groups.length === 0) return null;

  // Per-point colors for varied single-series charts (pie, doughnut, varied bars)
  for (const group of groups) {
    if (!group.varyColors && group.type !== "pie" && group.type !== "doughnut") continue;
    for (const s of group.series) {
      s.pointColors = s.values.map((_, i) => s.pointColors[i] ?? (group.varyColors ? colors.accent(i) : s.color));
    }
  }

  // Title
  let title: PptxChart["title"] = null;
  const titleEl = cChild(chart, "title");
  if (titleEl && !isOn(cChild(chart, "autoTitleDeleted"))) {
    const rich = cChild(cChild(titleEl, "tx"), "rich");
    const text = rich
      ? childElements(rich, "a:p")
          .map((p) => findAll(p, (el) => el.name === "a:t").map((t) => textContent(t)).join(""))
          .join("\n")
      : groups[0].series.length === 1
        ? groups[0].series[0].name
        : "";
    if (text.trim()) {
      title = {
        text,
        style: textStyleFrom(rich ?? cChild(titleEl, "txPr"), { ...baseStyle, size: baseStyle.size * 1.4, bold: false }, colors),
      };
    }
  }

  // Legend
  let legend: PptxChart["legend"] = null;
  const legendEl = cChild(chart, "legend");
  if (legendEl) {
    const pos = cChild(legendEl, "legendPos")?.attrs.val ?? "r";
    const first = groups[0];
    const byPoint =
      (first.type === "pie" || first.type === "doughnut" || first.varyColors) && first.series.length === 1;
    const entries = byPoint
      ? categories.map((label, i) => ({ label, color: first.series[0].pointColors[i] ?? colors.accent(i) }))
      : groups.flatMap((g) => g.series.map((s) => ({ label: s.name, color: s.color })));
    legend = {
      position: (["r", "l", "t", "b", "tr"].includes(pos) ? pos : "r") as "r" | "l" | "t" | "b" | "tr",
      style: textStyleFrom(cChild(legendEl, "txPr"), baseStyle, colors),
      entries,
    };
  }

  // Manual inner layout
  let plotLayout: PptxChart["plotArea"] = null;
  const manual = cChild(cChild(plotArea, "layout"), "manualLayout");
  if (manual) {
    const x = Number(cChild(manual, "x")?.attrs.val);
    const y = Number(cChild(manual, "y")?.attrs.val);
    const w = Number(cChild(manual, "w")?.attrs.val);
    const h = Number(cChild(manual, "h")?.attrs.val);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) plotLayout = { x, y, w, h };
  }

  const background = colors.fill(cChild(space, "spPr")) ?? null;

  return {
    groups,
    categories,
    title,
    legend,
    plotArea: plotLayout,
    categoryAxis: parseAxis(cChild(plotArea, "catAx") ?? cChild(plotArea, "dateAx"), baseStyle, colors),
    valueAxis: parseAxis(cChild(plotArea, "valAx"), baseStyle, colors),
    background,
  };
}

/** Formats a number using the leading part of an Excel number format. */
export function formatChartNumber(value: number, format: string | null, asPercent = false): string {
  if (!Number.isFinite(value)) return "";
  const fmt = (format ?? "").split(";")[0];
  const percent = asPercent || fmt.includes("%");
  const decimalsMatch = /\.(0+)/.exec(fmt);
  const decimals = decimalsMatch ? decimalsMatch[1].length : percent ? 0 : Number.isInteger(value) ? 0 : 2;
  const n = percent ? value * 100 : value;
  const grouped = fmt.includes(",") || (!fmt && Math.abs(n) >= 10000);
  const text = n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
  return percent ? `${text}%` : text;
}

/** Short plain-text summary of the chart data (for search and AI context). */
export function chartToText(chart: PptxChart): string {
  const lines: string[] = [];
  if (chart.title) lines.push(chart.title.text);
  for (const group of chart.groups) {
    for (const s of group.series) {
      const points = s.values
        .map((v, i) => `${chart.categories[i] ?? s.xValues?.[i] ?? i + 1}: ${formatChartNumber(v, null)}`)
        .join(", ");
      lines.push(`[Chart ${group.type}] ${s.name} — ${points}`);
    }
  }
  return lines.join("\n");
}
