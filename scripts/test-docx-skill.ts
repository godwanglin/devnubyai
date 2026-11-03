import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildDocumentBuffer } from "../src/lib/tools/create-document";
import { buildSkillsSystemPromptBlock, listDevnubySkills, loadDevnubySkill } from "../src/lib/skills/runtime";
import { loadSkillTool } from "../src/lib/tools/load-skill";

async function testSkillRuntime() {
  const skills = await listDevnubySkills();
  const docx = skills.find((s) => s.name === "docx");
  assert(docx, "docx skill must be discovered in .devnuby/skills");
  assert(docx.description.length > 20);

  const detail = await loadDevnubySkill("docx");
  assert(detail);
  assert(!detail.content.startsWith("---"), "frontmatter must be stripped from content");
  assert(detail.content.includes("create_document"));

  assert.equal(await loadDevnubySkill("../../package"), null, "path traversal must not resolve");

  const block = await buildSkillsSystemPromptBlock();
  assert(block.includes("`docx`"));
  assert(block.includes("load_skill"));

  const ctx = { userId: "u", sessionId: "s" };
  const ok = await loadSkillTool.execute({ name: "docx" }, ctx);
  assert.equal(ok.success, true);
  const missing = await loadSkillTool.execute({ name: "nope" }, ctx);
  assert.equal(missing.error?.code, "NOT_FOUND");
  assert(missing.error?.message.includes("'docx'"));
  console.log("✓ .devnuby/skills runtime discovers, loads, and lists the docx skill");
}

async function testRichDocument() {
  const buffer = await buildDocumentBuffer(
    {
      filename: "Proposal.docx",
      title: "Cloud Migration Strategy",
      subtitle: "Prepared for Acme Corp • November 2026",
      headerText: "Acme Corp — Proposal",
      footerText: "Confidential",
      orientation: "landscape",
      sections: [
        { type: "heading", level: 1, text: "1. Executive Summary" },
        {
          type: "paragraph",
          runs: [
            { text: "Read the " },
            { text: "full roadmap", bold: true, color: "#1E3A8A" },
            { text: " at " },
            { text: "devnuby.id", link: "https://chat.devnuby.id" },
            { text: "unsafe", link: "javascript:alert(1)" },
          ],
        },
        { type: "callout", title: "Key Objective", text: "99.99% availability.", variant: "warning" },
        { type: "divider" },
        { type: "bullet_list", items: ["Audit", "Migrate"] },
        { type: "numbered_list", items: ["Plan", "Execute"] },
        {
          type: "table",
          headers: ["Phase", "Duration"],
          rows: [["Phase 1", "2 Weeks"], ["Phase 2", 4]],
        },
        { type: "page_break" },
        { type: "paragraph", text: "Appendix", color: "not-a-hex" },
      ],
    },
    "Proposal.docx"
  );

  assert(buffer.length > 1000);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert(xml.includes("Executive Summary"));
  assert(xml.includes("Key Objective"));
  assert(xml.includes('w:orient="landscape"'), "landscape orientation must be applied");
  assert(xml.includes('w:tblHeader'), "header row must repeat across pages");
  assert(xml.includes("F8FAFC"), "zebra shading must be applied on alternate rows");
  assert(!xml.includes("javascript:"), "non-http links must not become hyperlinks");

  const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  assert(rels.includes("https://chat.devnuby.id"));
  assert(!rels.includes("javascript:"));

  const headerFile = Object.keys(zip.files).find((f) => /^word\/header\d*\.xml$/.test(f));
  const footerFile = Object.keys(zip.files).find((f) => /^word\/footer\d*\.xml$/.test(f));
  assert(headerFile && footerFile);
  const footerXml = await zip.file(footerFile)!.async("string");
  assert(footerXml.includes("Confidential"));
  assert(footerXml.includes("NUMPAGES"), "footer must contain total page field");

  const outDir = path.join(process.cwd(), ".logs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "test-docx-skill.docx"), buffer);
  console.log("✓ create_document renders header/footer, page numbers, callout, links, zebra table, landscape");
}

async function testPlainDocumentStillWorks() {
  const buffer = await buildDocumentBuffer(
    { filename: "a.docx", sections: [{ type: "paragraph", text: "Hello" }] },
    "a.docx"
  );
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert(xml.includes("Hello"));
  assert(!Object.keys(zip.files).some((f) => /^word\/footer\d*\.xml$/.test(f)), "no footer unless requested");
  console.log("✓ Minimal documents still render without header/footer");
}

async function main() {
  await testSkillRuntime();
  await testRichDocument();
  await testPlainDocumentStillWorks();
  console.log("\nAll docx skill tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
