import { collectTextBoxContents, placeFloatingDrawings, placeFlowDrawings } from "./docx-drawings";
import { paginateDocxPages, waitForDocxLayout } from "./docx-paginate";
import { prepareDocx } from "./docx-prepare";
import { markSectionPageBreaks } from "./docx-sections";
import { alignMultipleLineSpacing, applyFontFallbacks } from "./docx-text-fixes";

/**
 * Full DOCX → paged HTML pipeline behind the side-panel preview:
 * prepare the package (drawings, table indents, fonts) → docx-preview renders text,
 * tables and styles → drawings are placed → overflowing pages are split.
 */

export const DOCX_PAGE_WRAPPER_CLASS = "docx-wrapper";

const RENDER_OPTIONS = {
  className: "docx",
  inWrapper: true,
  breakPages: true,
  // honour Word's own page markers; section breaks are marked explicitly
  ignoreLastRenderedPageBreak: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  renderComments: false,
  renderChanges: false,
  // altChunks embed raw HTML in an iframe — never render them
  renderAltChunks: false,
  useBase64URL: true,
  experimental: true,
};

async function renderNodes(blob: Blob): Promise<Node[]> {
  const { parseAsync, renderDocument } = await import("docx-preview");
  const doc = await parseAsync(blob, RENDER_OPTIONS);
  markSectionPageBreaks(doc);
  return renderDocument(doc, RENDER_OPTIONS);
}

/**
 * Renders `bytes` into `body` (pages) and `styles` (CSS). `isActive` lets the caller
 * abandon a render that was superseded; returns false in that case.
 */
export async function renderDocxPages(
  bytes: ArrayBuffer,
  body: HTMLElement,
  styles: HTMLElement,
  isActive: () => boolean = () => true
): Promise<boolean> {
  const prepared = await prepareDocx(bytes);
  const nodes = await renderNodes(prepared.main);
  // text boxes render in their own pass and are moved into their shapes
  const boxRoot = document.createElement("div");
  if (prepared.textBoxes) {
    boxRoot.append(...(await renderNodes(prepared.textBoxes)).filter((n) => n.nodeName !== "STYLE"));
  }
  if (!isActive()) return false;

  styles.replaceChildren(...nodes.filter((n) => n.nodeName === "STYLE"));
  body.replaceChildren(...nodes.filter((n) => n.nodeName !== "STYLE"));
  applyFontFallbacks([styles, body, boxRoot], prepared.fontFallbacks);
  const boxes = collectTextBoxContents(boxRoot, prepared);

  placeFlowDrawings(body, prepared, boxes);
  await waitForDocxLayout(body);
  if (!isActive()) return false;
  paginateDocxPages(body, DOCX_PAGE_WRAPPER_CLASS);
  placeFloatingDrawings(body, prepared, boxes);
  // visual-only shift, so it runs last: text-box paragraphs are in the page by now.
  // Measured at zoom 1 like the steps above, since offsets are written in unzoomed px.
  const prevZoom = body.style.zoom;
  body.style.zoom = "1";
  alignMultipleLineSpacing([body]);
  body.style.zoom = prevZoom;
  return true;
}
