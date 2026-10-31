import type { DocxDrawing, DrawingBox, DrawingNode, DrawingPosition } from "@/lib/files/parsers/docx-drawing";
import type { PreparedDocx } from "./docx-prepare";

/**
 * Draws the floating/inline drawings that `prepareDocx` lifted out of the document,
 * at the bookmark markers docx-preview rendered in their place:
 *
 * - inline, top-and-bottom and square/tight/through wraps join the text flow before
 *   pagination, so their height pushes text like in Word;
 * - `wrapNone` / behind-text drawings are laid over the finished page afterwards,
 *   positioned against the page, margins, paragraph or line as Word does.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

type TextBoxContents = HTMLElement[][];

function transformOf(box: DrawingBox): string {
  const parts: string[] = [];
  if (box.rotation) parts.push(`rotate(${box.rotation}deg)`);
  if (box.flipH) parts.push("scaleX(-1)");
  if (box.flipV) parts.push("scaleY(-1)");
  return parts.join(" ");
}

function positioned(box: DrawingBox, className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  Object.assign(el.style, {
    position: "absolute",
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    transform: transformOf(box),
  });
  return el;
}

/** SVG paint for a CSS fill; gradients degrade to their first stop. */
function svgPaint(fill: string | null): string {
  if (!fill) return "none";
  if (!fill.startsWith("linear-gradient")) return fill;
  return fill.match(/#[0-9a-f]{6}|rgba?\([^)]*\)/i)?.[0] ?? "none";
}

function renderGeometry(node: Extract<DrawingNode, { kind: "shape" }>, el: HTMLElement) {
  const { geometry, fill, line, box } = node;
  if (geometry.type === "rect" || geometry.type === "roundRect" || geometry.type === "ellipse") {
    // plain boxes stay CSS so gradients render exactly
    if (fill) el.style.background = fill;
    if (line) el.style.boxShadow = `inset 0 0 0 ${line.width}px ${line.color}`;
    if (geometry.type === "roundRect") el.style.borderRadius = `${geometry.radius}px`;
    if (geometry.type === "ellipse") el.style.borderRadius = "50%";
    return;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "visible" });
  const stroke = (shape: SVGElement) => {
    shape.setAttribute("fill", svgPaint(fill));
    shape.setAttribute("stroke", line?.color ?? "none");
    shape.setAttribute("stroke-width", String(line?.width ?? 0));
    shape.setAttribute("vector-effect", "non-scaling-stroke");
  };

  if (geometry.type === "line") {
    svg.setAttribute("viewBox", `0 0 ${Math.max(box.w, 1)} ${Math.max(box.h, 1)}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", "0");
    ln.setAttribute("y1", "0");
    ln.setAttribute("x2", String(box.w));
    ln.setAttribute("y2", String(box.h));
    stroke(ln);
    ln.setAttribute("stroke", line?.color ?? "#000000");
    ln.setAttribute("stroke-width", String(line?.width ?? 1));
    svg.appendChild(ln);
  } else {
    for (const p of geometry.paths) {
      const inner = document.createElementNS(SVG_NS, "svg");
      inner.setAttribute("viewBox", `0 0 ${p.w} ${p.h}`);
      inner.setAttribute("preserveAspectRatio", "none");
      inner.setAttribute("width", "100%");
      inner.setAttribute("height", "100%");
      inner.setAttribute("overflow", "visible");
      const shape = document.createElementNS(SVG_NS, "path");
      shape.setAttribute("d", p.d);
      stroke(shape);
      inner.appendChild(shape);
      svg.appendChild(inner);
    }
  }
  el.appendChild(svg);
}

function renderNode(node: DrawingNode, prepared: PreparedDocx, boxes: TextBoxContents): HTMLElement {
  const el = positioned(node.box, `devnuby-docx-${node.kind}`);

  if (node.kind === "group") {
    for (const c of node.children) el.appendChild(renderNode(c, prepared, boxes));
    return el;
  }

  if (node.kind === "picture") {
    const src = node.mediaPath ? prepared.media.get(node.mediaPath) : undefined;
    if (!src) return el;
    const [l, t, r, b] = node.crop;
    const scaleX = 1 - l - r > 0.001 ? 1 - l - r : 1;
    const scaleY = 1 - t - b > 0.001 ? 1 - t - b : 1;
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    Object.assign(img.style, {
      position: "absolute",
      left: `${(-l / scaleX) * 100}%`,
      top: `${(-t / scaleY) * 100}%`,
      width: `${(1 / scaleX) * 100}%`,
      height: `${(1 / scaleY) * 100}%`,
      maxWidth: "none",
      opacity: String(node.opacity),
    });
    el.style.overflow = "hidden";
    el.appendChild(img);
    return el;
  }

  renderGeometry(node, el);
  const content = node.textBox !== null ? boxes[node.textBox] : undefined;
  if (content?.length) {
    const text = document.createElement("div");
    const [top, right, bottom, left] = node.insets;
    Object.assign(text.style, {
      position: "absolute",
      inset: "0",
      boxSizing: "border-box",
      padding: `${top}px ${right}px ${bottom}px ${left}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent:
        node.verticalAnchor === "middle" ? "center" : node.verticalAnchor === "bottom" ? "flex-end" : "flex-start",
    });
    for (const p of content) text.appendChild(p.cloneNode(true));
    el.appendChild(text);
  }
  return el;
}

function renderDrawing(drawing: DocxDrawing, prepared: PreparedDocx, boxes: TextBoxContents): HTMLElement {
  const holder = document.createElement("div");
  holder.className = "devnuby-docx-drawing";
  Object.assign(holder.style, { position: "relative", width: `${drawing.width}px`, height: `${drawing.height}px` });
  holder.appendChild(renderNode(drawing.root, prepared, boxes));
  return holder;
}

/** Paragraph runs between consecutive text-box markers in the rendered synthetic document. */
export function collectTextBoxContents(root: HTMLElement, prepared: PreparedDocx): TextBoxContents {
  const markerParagraph = (i: number) =>
    root.querySelector(`[id="${prepared.markerPrefix}t${i}"]`)?.closest<HTMLElement>("p, article > *") ?? null;
  const contents: TextBoxContents = [];
  for (let i = 0; i < prepared.textBoxCount; i++) {
    const start = markerParagraph(i);
    const end = markerParagraph(i + 1);
    const items: HTMLElement[] = [];
    for (let el = start?.nextElementSibling ?? null; el && el !== end; el = el.nextElementSibling) {
      items.push(el as HTMLElement);
    }
    contents.push(items);
  }
  return contents;
}

function markers(body: HTMLElement, prepared: PreparedDocx): { el: HTMLElement; drawing: DocxDrawing }[] {
  const prefix = `${prepared.markerPrefix}d`;
  return Array.from(body.querySelectorAll<HTMLElement>(`[id^="${prefix}"]`)).flatMap((el) => {
    const drawing = prepared.drawings[Number(el.id.slice(prefix.length))];
    return drawing ? [{ el, drawing }] : [];
  });
}

interface PageMetrics {
  rect: DOMRect;
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

function pageMetrics(section: HTMLElement): PageMetrics {
  const cs = getComputedStyle(section);
  return {
    rect: section.getBoundingClientRect(),
    width: section.offsetWidth,
    height: section.offsetHeight,
    padding: {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    },
  };
}

/** Start and length of the box a position is measured against. */
function referenceSpan(pos: DrawingPosition, axis: "x" | "y", page: PageMetrics, marker: HTMLElement): [number, number] {
  const { padding: pad } = page;
  const size = axis === "x" ? page.width : page.height;
  const [near, far] = axis === "x" ? [pad.left, pad.right] : [pad.top, pad.bottom];
  const markerRect = marker.getBoundingClientRect();
  const para = (marker.closest("p") ?? marker.parentElement ?? marker).getBoundingClientRect();

  switch (pos.relativeFrom) {
    case "page":
      return [0, size];
    case "margin":
    case "column":
      return [near, size - near - far];
    case "leftMargin":
    case "topMargin":
    case "insideMargin":
      return [0, near];
    case "rightMargin":
    case "bottomMargin":
    case "outsideMargin":
      return [size - far, far];
    case "character":
      return [markerRect.left - page.rect.left, 0];
    case "line":
      return [markerRect.top - page.rect.top, markerRect.height];
    case "paragraph":
    default:
      return axis === "x" ? [near, size - near - far] : [para.top - page.rect.top, para.height];
  }
}

function resolvePosition(pos: DrawingPosition, axis: "x" | "y", extent: number, page: PageMetrics, marker: HTMLElement) {
  const [start, length] = referenceSpan(pos, axis, page, marker);
  switch (pos.align) {
    case "left":
    case "top":
    case "inside":
      return start;
    case "right":
    case "bottom":
    case "outside":
      return start + length - extent;
    case "center":
      return start + (length - extent) / 2;
    default:
      return start + pos.offset;
  }
}

/** Inline and text-wrapping drawings: placed in the text flow, before pages are split. */
export function placeFlowDrawings(body: HTMLElement, prepared: PreparedDocx, boxes: TextBoxContents) {
  for (const { el, drawing } of markers(body, prepared)) {
    if (drawing.wrap === "none" || drawing.behindDoc) continue;
    const node = renderDrawing(drawing, prepared, boxes);
    const [distT, distR, distB, distL] = drawing.distance;

    if (drawing.inline) {
      Object.assign(node.style, { display: "inline-block", verticalAlign: "baseline", textIndent: "0" });
    } else {
      const section = el.closest<HTMLElement>("section");
      const page = section ? pageMetrics(section) : null;
      const x = page ? resolvePosition(drawing.horizontal, "x", drawing.width, page, el) : 0;
      if (drawing.wrap === "topAndBottom") {
        const below = drawing.vertical.relativeFrom === "paragraph" ? Math.max(0, drawing.vertical.offset) : 0;
        const section = el.closest<HTMLElement>("section");
        const page = section ? pageMetrics(section) : null;
        const textArea = page ? page.width - page.padding.left - page.padding.right : drawing.width;
        const left = page ? page.padding.left + Math.max(0, (textArea - drawing.width) / 2) : 0;
        // span across all CSS columns so the drawing aligns with the page text area
        Object.assign(node.style, {
          columnSpan: "all",
          display: "block",
          marginTop: `${below + distT}px`,
          marginBottom: `${distB}px`,
          marginLeft: `${left}px`,
        });
        el.replaceWith(node);
        continue;
      } else {
        const center = page ? page.padding.left + (page.width - page.padding.left - page.padding.right) / 2 : 0;
        const right = drawing.horizontal.align === "right" || drawing.horizontal.align === "outside" ||
          (drawing.horizontal.align === null && x + drawing.width / 2 > center);
        Object.assign(node.style, {
          float: right ? "right" : "left",
          margin: `${distT}px ${distR}px ${distB}px ${distL}px`,
        });
      }
    }
    el.replaceWith(node);
  }
}

/** Free-floating (no wrap / behind text) drawings: laid over each finished page. */
export function placeFloatingDrawings(body: HTMLElement, prepared: PreparedDocx, boxes: TextBoxContents) {
  const prevZoom = body.style.zoom;
  body.style.zoom = "1";
  try {
    // top-and-bottom bands now sit on their final page: align each drawing to its page x
    // top-and-bottom drawings are already in the text flow; skip them here
    const items = markers(body, prepared).filter(({ drawing }) => drawing.wrap !== "topAndBottom").sort((a, b) => a.drawing.zIndex - b.drawing.zIndex);
    const placements = items.flatMap(({ el, drawing }) => {
      const section = el.closest<HTMLElement>("section");
      if (!section) return [];
      const page = pageMetrics(section);
      return [{
        el,
        drawing,
        section,
        x: resolvePosition(drawing.horizontal, "x", drawing.width, page, el),
        y: resolvePosition(drawing.vertical, "y", drawing.height, page, el),
      }];
    });
    // measure everything first: inserting overlays never moves text, but keep reads and writes apart
    placements.forEach(({ el, drawing, section, x, y }, i) => {
      const node = renderDrawing(drawing, prepared, boxes);
      Object.assign(node.style, {
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: drawing.behindDoc ? "-1" : String(2 + i),
        pointerEvents: "none",
      });
      section.appendChild(node);
      el.remove();
    });
  } finally {
    body.style.zoom = prevZoom;
  }
}
