/**
 * Text-level corrections applied to docx-preview's HTML so it reads like Word.
 */

/** Appends Word's substitution chain to every font-family docx-preview wrote. */
export function applyFontFallbacks(roots: HTMLElement[], fallbacks: Map<string, string[]>) {
  if (!fallbacks.size) return;
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy)$/;
  const quote = (f: string) => (generic.test(f) ? f : `"${f}"`);
  const expand = (value: string) => {
    const families = value.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const extra = fallbacks.get(families[0]?.toLowerCase() ?? "");
    if (!extra) return value;
    return [...families, ...extra.filter((f) => !families.includes(f))].map(quote).join(", ");
  };
  for (const root of roots) {
    for (const style of Array.from(root.querySelectorAll("style"))) {
      style.textContent = (style.textContent ?? "").replace(
        /font-family:\s*([^;{}]+)/g,
        (_, value: string) => `font-family: ${expand(value)}`
      );
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style*="font-family"]'))) {
      el.style.fontFamily = expand(el.style.fontFamily);
    }
  }
}

/** Top of the first glyph box in `p`, or null for a paragraph without text. */
function firstGlyphTop(p: HTMLElement): number | null {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const at = n.data.search(/\S/);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(n, at);
    range.setEnd(n, at + 1);
    const rect = range.getClientRects()[0];
    if (rect) return rect.top;
  }
  return null;
}

/**
 * Word lays "multiple" line spacing (w:lineRule="auto") out with the text at the top of
 * each line and the extra space below it; CSS centres text in the line box. Shift such
 * paragraphs up by the leading CSS put above the first line (measured, since run font
 * sizes rather than the paragraph's decide the line box) so glyphs land where Word
 * draws them. Only paragraph boxes move visually — layout and pagination are untouched.
 */
export function alignMultipleLineSpacing(roots: HTMLElement[]) {
  for (const root of roots) {
    for (const p of Array.from(root.querySelectorAll<HTMLElement>("p"))) {
      // docx-preview writes multiples as a unitless inline line-height
      if (!/^\d+(\.\d+)?$/.test(p.style.lineHeight) || Number(p.style.lineHeight) <= 1) continue;
      const glyphTop = firstGlyphTop(p);
      if (glyphTop === null) continue;
      const pRect = p.getBoundingClientRect();
      const padTop = parseFloat(getComputedStyle(p).paddingTop) || 0;
      const shift = glyphTop - pRect.top - padTop;
      if (!(shift > 0.5)) continue;
      p.style.position = "relative";
      p.style.top = `${-shift}px`;
    }
  }
}
