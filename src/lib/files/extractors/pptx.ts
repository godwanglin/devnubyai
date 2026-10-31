import type { ExtractorResult } from "./types";

/**
 * Extracts slide text from PowerPoint presentations (.pptx) slide-by-slide using jszip.
 * Inserts explicit slide delimiters `=== [SLIDE X] ===`.
 */
export async function extractPptxText(buffer: Buffer): Promise<ExtractorResult> {
  try {
    const JSZipModule = await import("jszip");
    const JSZip = (JSZipModule.default || JSZipModule) as unknown as typeof import("jszip");
    const zip = await JSZip.loadAsync(buffer);

    // Find all slide XML files
    const slideEntries = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(name)
    );

    // Sort slides numerically: slide1.xml, slide2.xml, ... slide10.xml
    slideEntries.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });

    let fullOutput = "";
    let slideCount = 0;

    for (let i = 0; i < slideEntries.length; i++) {
      slideCount++;
      const slideFile = zip.file(slideEntries[i]);
      if (!slideFile) continue;

      const xml = await slideFile.async("string");

      // Extract paragraphs (<a:p>) and text items (<a:t>)
      const paragraphMatches = xml.match(/<a:p[\s\S]*?<\/a:p>/gi) || [];
      const lines: string[] = [];

      for (const pXml of paragraphMatches) {
        const textMatches = pXml.match(/<a:t[^>]*>([^<]*)<\/a:t>/gi) || [];
        const lineText = textMatches
          .map((t) => t.replace(/<[^>]+>/g, "").trim())
          .filter(Boolean)
          .join(" ");

        if (lineText) {
          lines.push(lineText);
        }
      }

      if (lines.length > 0) {
        fullOutput += `\n\n=== [SLIDE ${slideCount}] ===\n${lines.join("\n")}`;
      }
    }

    const trimmed = fullOutput.trim();

    return {
      success: true,
      text: trimmed,
      pageOrSheetCount: slideCount,
      metadata: {
        totalSlides: slideCount,
        charCount: trimmed.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
