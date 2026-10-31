"use client";

import React from "react";
import {
  formatChartNumber,
  type PptxChart,
  type PptxChartGroup,
  type PptxChartTextStyle,
} from "@/lib/files/parsers/pptx-chart";

export interface PptxChartViewProps {
  chart: PptxChart;
  /** Chart frame size in slide points */
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GRID_COLOR = "rgba(127,127,127,0.35)";

function fontFamily(style: PptxChartTextStyle): string {
  const clean = style.font?.replace(/["\\;]/g, "").trim();
  return clean ? `"${clean}", "Segoe UI", system-ui, sans-serif` : `"Segoe UI", system-ui, sans-serif`;
}

function textProps(style: PptxChartTextStyle): React.SVGProps<SVGTextElement> {
  return {
    fill: style.color,
    fontSize: style.size,
    fontWeight: style.bold ? 700 : 400,
    fontFamily: fontFamily(style),
  };
}

/** Rough text width estimate (no DOM measuring inside SVG render). */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.55;
}

function niceScale(min: number, max: number, targetTicks = 5): { min: number; max: number; step: number } {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
    step,
  };
}

// ---------------------------------------------------------------------------
// Pie & doughnut
// ---------------------------------------------------------------------------

function arcPath(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  if (full) {
    // Two half arcs: SVG cannot draw a single 360° arc
    const mid = a0 + Math.PI;
    return arcPath(cx, cy, r, inner, a0, mid) + " " + arcPath(cx, cy, r, inner, mid, a1);
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (radius: number, a: number) => `${cx + radius * Math.cos(a)} ${cy + radius * Math.sin(a)}`;
  if (inner <= 0) {
    return `M ${cx} ${cy} L ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} Z`;
  }
  return `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
}

function PieChart({ chart, group, plot }: { chart: PptxChart; group: PptxChartGroup; plot: Rect }) {
  const series = group.series[0];
  const values = series.values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const r = Math.min(plot.w, plot.h) / 2;
  const inner = group.type === "doughnut" ? r * (group.holeSize / 100) : 0;
  const labels = series.labels;

  // DrawingML: first slice starts at 12 o'clock, clockwise; SVG angle 0 is 3 o'clock
  const startAngle = -Math.PI / 2 + (group.firstSliceAngle * Math.PI) / 180;
  const angles = values.reduce<number[]>((acc, v, i) => {
    const prev = i === 0 ? startAngle : acc[i - 1];
    acc.push(prev + (v > 0 ? (v / total) * Math.PI * 2 : 0));
    return acc;
  }, []);
  const a0s = [startAngle, ...angles.slice(0, -1)];

  return (
    <g>
      {values.map((v, i) => {
        if (v <= 0) return null;
        const a0 = a0s[i];
        const a1 = angles[i];
        const mid = (a0 + a1) / 2;
        const color = series.pointColors[i] ?? series.color;

        let label = "";
        if (labels) {
          const parts: string[] = [];
          if (labels.showCategory) parts.push(chart.categories[i] ?? "");
          if (labels.showValue) parts.push(formatChartNumber(v, labels.format && !labels.format.includes("%") ? labels.format : null));
          if (labels.showPercent) parts.push(formatChartNumber(v / total, labels.format, true));
          label = parts.filter(Boolean).join(" ");
        }

        // Doughnut labels sit on the ring; pie labels inside unless placed outside
        const outside = labels?.position === "outEnd";
        const labelRadius = inner > 0 ? (r + inner) / 2 : outside ? r * 1.15 : r * 0.65;

        return (
          <g key={i}>
            <path d={arcPath(cx, cy, r, inner, a0, a1)} fill={color} />
            {label && labels && (
              <text
                x={cx + labelRadius * Math.cos(mid)}
                y={cy + labelRadius * Math.sin(mid)}
                textAnchor="middle"
                dominantBaseline="central"
                {...textProps(labels.style)}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Cartesian (bar, column, line, area, scatter)
// ---------------------------------------------------------------------------

function stackedTotals(group: PptxChartGroup, nCat: number): { pos: number[]; neg: number[] } {
  const pos = new Array(nCat).fill(0);
  const neg = new Array(nCat).fill(0);
  for (const s of group.series) {
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      if (v >= 0) pos[i] += v;
      else neg[i] += v;
    });
  }
  return { pos, neg };
}

function valueRange(chart: PptxChart, nCat: number): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const group of chart.groups) {
    if (group.type === "pie" || group.type === "doughnut") continue;
    if (group.grouping === "percentStacked") {
      max = Math.max(max, 1);
      continue;
    }
    if (group.grouping === "stacked") {
      const { pos, neg } = stackedTotals(group, nCat);
      max = Math.max(max, ...pos);
      min = Math.min(min, ...neg);
      continue;
    }
    for (const s of group.series) {
      for (const v of s.values) {
        if (!Number.isFinite(v)) continue;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
  }
  const axis = chart.valueAxis;
  return {
    min: axis?.min ?? min,
    max: axis?.max ?? (max === min ? min + 1 : max),
  };
}

function CartesianChart({ chart, plot }: { chart: PptxChart; plot: Rect }) {
  const horizontal = chart.groups.some((g) => g.type === "bar" && g.horizontal);
  const scatter = chart.groups.find((g) => g.type === "scatter");
  const nCat = Math.max(
    chart.categories.length,
    ...chart.groups.flatMap((g) => g.series.map((s) => s.values.length)),
    1
  );

  const raw = valueRange(chart, nCat);
  const isPercent = chart.groups.some((g) => g.grouping === "percentStacked");
  const scale = niceScale(raw.min, raw.max);
  const vMin = chart.valueAxis?.min ?? scale.min;
  const vMax = chart.valueAxis?.max ?? scale.max;
  const span = vMax - vMin || 1;

  // Value → pixel along the value axis
  const valuePos = (v: number) =>
    horizontal ? plot.x + ((v - vMin) / span) * plot.w : plot.y + plot.h - ((v - vMin) / span) * plot.h;
  const band = (horizontal ? plot.h : plot.w) / nCat;
  const catCenter = (i: number) =>
    horizontal ? plot.y + band * (i + 0.5) : plot.x + band * (i + 0.5);

  const valueStyle = chart.valueAxis?.style;
  const catStyle = chart.categoryAxis?.style;
  const elements: React.ReactNode[] = [];

  // Gridlines & value-axis labels
  const ticks: number[] = [];
  for (let v = vMin; v <= vMax + scale.step * 0.001; v += scale.step) ticks.push(Number(v.toFixed(10)));
  ticks.forEach((v, i) => {
    const p = valuePos(v);
    if (chart.valueAxis?.gridlines !== false) {
      elements.push(
        horizontal ? (
          <line key={`g${i}`} x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} stroke={GRID_COLOR} strokeWidth={0.75} />
        ) : (
          <line key={`g${i}`} x1={plot.x} x2={plot.x + plot.w} y1={p} y2={p} stroke={GRID_COLOR} strokeWidth={0.75} />
        )
      );
    }
    if (valueStyle && chart.valueAxis?.visible !== false) {
      const label = formatChartNumber(v, chart.valueAxis?.format ?? null, isPercent);
      elements.push(
        horizontal ? (
          <text key={`v${i}`} x={p} y={plot.y + plot.h + valueStyle.size * 1.2} textAnchor="middle" {...textProps(valueStyle)}>
            {label}
          </text>
        ) : (
          <text key={`v${i}`} x={plot.x - valueStyle.size * 0.5} y={p} textAnchor="end" dominantBaseline="central" {...textProps(valueStyle)}>
            {label}
          </text>
        )
      );
    }
  });

  // Category labels
  if (catStyle && chart.categoryAxis?.visible !== false && !scatter) {
    chart.categories.forEach((c, i) => {
      elements.push(
        horizontal ? (
          <text key={`c${i}`} x={plot.x - catStyle.size * 0.5} y={catCenter(i)} textAnchor="end" dominantBaseline="central" {...textProps(catStyle)}>
            {c}
          </text>
        ) : (
          <text key={`c${i}`} x={catCenter(i)} y={plot.y + plot.h + catStyle.size * 1.2} textAnchor="middle" {...textProps(catStyle)}>
            {c}
          </text>
        )
      );
    });
  }

  // Axis baseline at zero
  const zero = valuePos(Math.min(Math.max(0, vMin), vMax));
  elements.push(
    horizontal ? (
      <line key="axis" x1={zero} x2={zero} y1={plot.y} y2={plot.y + plot.h} stroke="rgba(127,127,127,0.8)" strokeWidth={1} />
    ) : (
      <line key="axis" x1={plot.x} x2={plot.x + plot.w} y1={zero} y2={zero} stroke="rgba(127,127,127,0.8)" strokeWidth={1} />
    )
  );

  for (const [gi, group] of chart.groups.entries()) {
    if (group.type === "bar") {
      const stacked = group.grouping === "stacked" || group.grouping === "percentStacked";
      const gapRatio = group.gapWidth / 100;
      const groupWidth = band / (1 + gapRatio);
      const nSer = group.series.length;
      const overlap = Math.max(-1, Math.min(1, group.overlap / 100));
      const barWidth = stacked ? groupWidth : groupWidth / (nSer - (nSer - 1) * Math.max(overlap, 0));
      const step = stacked ? 0 : barWidth * (1 - Math.max(overlap, 0));
      const totals = group.grouping === "percentStacked" ? stackedTotals(group, nCat) : null;
      const posAcc = new Array(nCat).fill(0);
      const negAcc = new Array(nCat).fill(0);

      group.series.forEach((s, si) => {
        s.values.forEach((raw, ci) => {
          if (!Number.isFinite(raw)) return;
          let v = raw;
          if (totals) {
            const t = raw >= 0 ? totals.pos[ci] : -totals.neg[ci];
            v = t ? raw / t : 0;
          }
          let start = 0;
          if (stacked) {
            start = v >= 0 ? posAcc[ci] : negAcc[ci];
            if (v >= 0) posAcc[ci] += v;
            else negAcc[ci] += v;
          }
          const a = valuePos(start);
          const b = valuePos(start + v);
          const offset = catCenter(ci) - groupWidth / 2 + (stacked ? 0 : si * step);
          const color = s.pointColors[ci] ?? s.color;
          const rect = horizontal
            ? { x: Math.min(a, b), y: offset, width: Math.abs(b - a), height: barWidth }
            : { x: offset, y: Math.min(a, b), width: barWidth, height: Math.abs(b - a) };
          elements.push(<rect key={`b${gi}-${si}-${ci}`} {...rect} fill={color} />);

          if (s.labels && (s.labels.showValue || s.labels.showPercent)) {
            const text = s.labels.showPercent && totals
              ? formatChartNumber(v, null, true)
              : formatChartNumber(raw, s.labels.format);
            const style = s.labels.style;
            elements.push(
              horizontal ? (
                <text key={`bl${gi}-${si}-${ci}`} x={Math.max(a, b) + style.size * 0.3} y={offset + barWidth / 2} dominantBaseline="central" {...textProps(style)}>
                  {text}
                </text>
              ) : (
                <text key={`bl${gi}-${si}-${ci}`} x={offset + barWidth / 2} y={Math.min(a, b) - style.size * 0.3} textAnchor="middle" {...textProps(style)}>
                  {text}
                </text>
              )
            );
          }
        });
      });
    } else if (group.type === "line" || group.type === "area") {
      const stacked = group.grouping === "stacked" || group.grouping === "percentStacked";
      const acc = new Array(nCat).fill(0);
      const totals = group.grouping === "percentStacked" ? stackedTotals(group, nCat) : null;

      group.series.forEach((s, si) => {
        const pts: { x: number; y: number; v: number }[] = [];
        s.values.forEach((raw, ci) => {
          if (!Number.isFinite(raw)) return;
          let v = totals ? (totals.pos[ci] ? raw / totals.pos[ci] : 0) : raw;
          if (stacked) {
            acc[ci] += v;
            v = acc[ci];
          }
          pts.push({ x: catCenter(ci), y: valuePos(v), v: raw });
        });
        if (pts.length === 0) return;
        const d = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
        if (group.type === "area") {
          const base = valuePos(Math.max(vMin, 0));
          elements.push(
            <path key={`a${gi}-${si}`} d={`${d} L ${pts[pts.length - 1].x} ${base} L ${pts[0].x} ${base} Z`} fill={s.color} fillOpacity={0.85} />
          );
        } else {
          elements.push(<path key={`l${gi}-${si}`} d={d} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" />);
          if (s.marker) {
            pts.forEach((p, i) => elements.push(<circle key={`m${gi}-${si}-${i}`} cx={p.x} cy={p.y} r={3.5} fill={s.color} />));
          }
        }
        if (s.labels?.showValue) {
          const style = s.labels.style;
          pts.forEach((p, i) =>
            elements.push(
              <text key={`ll${gi}-${si}-${i}`} x={p.x} y={p.y - style.size * 0.6} textAnchor="middle" {...textProps(style)}>
                {formatChartNumber(p.v, s.labels!.format)}
              </text>
            )
          );
        }
      });
    } else if (group.type === "scatter") {
      const xs = group.series.flatMap((s) => (s.xValues ?? s.values.map((_, i) => i + 1)).filter(Number.isFinite));
      const xScale = niceScale(Math.min(...xs, 0), Math.max(...xs, 1));
      const xPos = (x: number) => plot.x + ((x - xScale.min) / (xScale.max - xScale.min || 1)) * plot.w;
      group.series.forEach((s, si) => {
        const xVals = s.xValues ?? s.values.map((_, i) => i + 1);
        const pts = s.values
          .map((v, i) => ({ x: xPos(xVals[i]), y: valuePos(v), ok: Number.isFinite(v) && Number.isFinite(xVals[i]) }))
          .filter((p) => p.ok);
        pts.forEach((p, i) => elements.push(<circle key={`s${gi}-${si}-${i}`} cx={p.x} cy={p.y} r={3.5} fill={s.color} />));
      });
    }
  }

  return <g>{elements}</g>;
}

// ---------------------------------------------------------------------------
// Layout, legend, title
// ---------------------------------------------------------------------------

function LegendView({ legend, area }: { legend: NonNullable<PptxChart["legend"]>; area: Rect }) {
  const size = legend.style.size;
  const swatch = size * 0.75;
  const rowGap = size * 0.5;
  const vertical = legend.position === "r" || legend.position === "l" || legend.position === "tr";

  if (vertical) {
    const rowH = size + rowGap;
    const totalH = legend.entries.length * rowH;
    const startY = legend.position === "tr" ? area.y : area.y + (area.h - totalH) / 2;
    return (
      <g>
        {legend.entries.map((e, i) => {
          const y = startY + i * rowH + rowH / 2;
          return (
            <g key={i}>
              <rect x={area.x} y={y - swatch / 2} width={swatch} height={swatch} fill={e.color} />
              <text x={area.x + swatch + size * 0.4} y={y} dominantBaseline="central" {...textProps(legend.style)}>
                {e.label}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  const widths = legend.entries.map((e) => swatch + size * 0.4 + textWidth(e.label, size) + size);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const startX = area.x + Math.max(0, (area.w - totalW) / 2);
  const positions = widths.reduce<number[]>((acc, w, i) => {
    acc.push((i === 0 ? startX : acc[i - 1] + widths[i - 1]));
    return acc;
  }, []);
  const y = area.y + area.h / 2;
  return (
    <g>
      {legend.entries.map((e, i) => {
        const x0 = positions[i];
        return (
          <g key={i}>
            <rect x={x0} y={y - swatch / 2} width={swatch} height={swatch} fill={e.color} />
            <text x={x0 + swatch + size * 0.4} y={y} dominantBaseline="central" {...textProps(legend.style)}>
              {e.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Splits the chart frame into title, legend and plot areas. */
function layoutChart(chart: PptxChart, width: number, height: number, radial: boolean) {
  const pad = Math.min(width, height) * 0.04;
  let area: Rect = { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 };

  let titleY: number | null = null;
  if (chart.title) {
    const lines = chart.title.text.split("\n").length;
    const th = chart.title.style.size * 1.3 * lines;
    titleY = area.y + chart.title.style.size;
    area = { ...area, y: area.y + th + pad * 0.5, h: area.h - th - pad * 0.5 };
  }

  let legendArea: Rect | null = null;
  if (chart.legend) {
    const size = chart.legend.style.size;
    if (chart.legend.position === "t" || chart.legend.position === "b") {
      const lh = size * 1.8;
      legendArea = {
        x: area.x,
        y: chart.legend.position === "t" ? area.y : area.y + area.h - lh,
        w: area.w,
        h: lh,
      };
      area = { ...area, y: chart.legend.position === "t" ? area.y + lh : area.y, h: area.h - lh };
    } else {
      const longest = Math.max(...chart.legend.entries.map((e) => textWidth(e.label, size)), 0);
      const lw = Math.min(area.w * 0.4, size * 1.6 + longest + pad);
      legendArea = {
        x: chart.legend.position === "l" ? area.x : area.x + area.w - lw + pad * 0.5,
        y: area.y,
        w: lw,
        h: area.h,
      };
      area = { ...area, x: chart.legend.position === "l" ? area.x + lw : area.x, w: area.w - lw };
    }
  }

  let plot: Rect;
  if (chart.plotArea) {
    // Manual layout is relative to the whole chart frame
    plot = {
      x: chart.plotArea.x * width,
      y: chart.plotArea.y * height,
      w: chart.plotArea.w * width,
      h: chart.plotArea.h * height,
    };
  } else if (radial) {
    plot = area;
  } else {
    // Leave room for axis labels
    const valueSize = chart.valueAxis?.visible !== false ? chart.valueAxis?.style.size ?? 0 : 0;
    const catSize = chart.categoryAxis?.visible !== false ? chart.categoryAxis?.style.size ?? 0 : 0;
    const horizontal = chart.groups.some((g) => g.type === "bar" && g.horizontal);
    const longestCat = Math.max(...chart.categories.map((c) => textWidth(c, catSize)), 0);
    const left = horizontal ? Math.min(longestCat + catSize, area.w * 0.35) : valueSize * 3.5;
    const bottom = horizontal ? valueSize * 1.8 : catSize * 1.8;
    plot = { x: area.x + left, y: area.y + pad * 0.5, w: area.w - left - pad, h: area.h - bottom - pad * 0.5 };
  }

  return { plot, titleY, legendArea };
}

/** Renders a DrawingML chart as SVG in slide points (1 unit = 1pt). */
export function PptxChartView({ chart, width, height }: PptxChartViewProps) {
  const first = chart.groups[0];
  const radial = first.type === "pie" || first.type === "doughnut";
  const { plot, titleY, legendArea } = layoutChart(chart, width, height, radial);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0, overflow: "visible" }}
      role="img"
      aria-label={chart.title?.text ?? "Chart"}
    >
      {chart.background && <rect x={0} y={0} width={width} height={height} fill={chart.background} />}
      {chart.title && titleY !== null && (
        <text x={width / 2} y={titleY} textAnchor="middle" {...textProps(chart.title.style)}>
          {chart.title.text}
        </text>
      )}
      {radial ? <PieChart chart={chart} group={first} plot={plot} /> : <CartesianChart chart={chart} plot={plot} />}
      {chart.legend && legendArea && <LegendView legend={chart.legend} area={legendArea} />}
    </svg>
  );
}
