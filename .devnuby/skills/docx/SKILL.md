---
name: docx
title: Professional Word Document Creation (.docx)
description: Best practices, styling guidelines, and structural schemas for generating clean, modern, professional Microsoft Word (.docx) documents in Devnuby AI using create_document.
version: 1.0.0
---

# Professional Microsoft Word (.docx) Document Guide

When creating `.docx` documents for users (CV/Resume, Cover Letters, Formal Proposals, Business Reports, Invoices, Contracts, Memos, Whitepapers), apply this skill to produce visually refined, publication-ready output instead of generic unstyled text.

---

## 1. Visual Hierarchy & Typography Standards

### Font Families & Sizes
- **Document Title**: 24pt - 28pt, Bold, Centered or Left-aligned with subtle accent color.
- **Subtitle / Metadata**: 11pt - 12pt, Italic or Muted (Slate `#64748B`), bottom spacing.
- **Heading 1**: 18pt - 20pt, Bold, primary accent color (e.g. Navy `#1E3A8A` or Slate `#0F172A`), top spacing 240-360 dxa, bottom spacing 120 dxa.
- **Heading 2**: 14pt - 16pt, Bold, secondary accent, bottom border / divider line where suitable.
- **Heading 3**: 12pt - 13pt, Semi-bold.
- **Body Paragraphs**: 11pt - 12pt (size 22-24 half-points), 1.15 line spacing, 6pt-8pt after paragraph. Never collapse line spacing to 1.0 (hard to read).

### Color Palettes
Pick one cohesive palette per document based on genre:
1. **Corporate / Legal / Formal**:
   - Primary: Deep Navy (`#0F172A` / `#1E3A8A`)
   - Secondary / Header Fill: Slate (`#1E293B`)
   - Accent: Steel Blue (`#2563EB`)
   - Muted text: `#64748B`
   - Border / Dividers: `#E2E8F0`
2. **Modern Tech / Startup / Proposal**:
   - Primary: Indigo (`#312E81` / `#4338CA`)
   - Accent: Teal (`#0D9488`) or Cyan (`#0284C7`)
   - Soft Background: Light Slate (`#F8FAFC`)
3. **Warm Editorial / Creative**:
   - Primary: Charcoal (`#292524`)
   - Accent: Warm Terracotta (`#C2410C`) or Amber (`#D97706`)

---

## 2. Document Layout & Structure Patterns

### A. Resume / Curriculum Vitae (CV)
1. **Header Block**: Candidate Name (Title, bold), Subtitle with Contact Info (Email, Phone, Location, LinkedIn, Portfolio on one clean line separated by ` | `).
2. **Professional Summary**: A focused 3-4 sentence paragraph highlighting core strengths.
3. **Core Competencies / Skills**: 2-column or 3-column table without heavy outer borders, or categorized bullet lists (e.g., Languages, Frameworks, Tools, Soft Skills).
4. **Professional Experience**:
   - Heading 2 for each Role: `[Job Title] — [Company Name]` (bold) with `[Start Date] – [End Date] | [Location]` (italic/muted).
   - Bullet list of high-impact achievements using action verbs and quantified results (e.g., "Increased conversion by 34%...").
5. **Education & Certifications**: Degree, Institution, Graduation Year, Honors.
6. **Projects / Publications**: Brief description, tech stack, link/impact.

### B. Business / Project Proposal
1. **Cover / Header**: Project Title, Client Name, Prepared By, Date.
2. **Executive Summary**: High-level problem statement and recommended solution.
3. **Scope of Work & Deliverables**: Detailed bulleted or numbered breakdown of phases.
4. **Timeline & Milestones**: Table containing Phase, Deliverables, Estimated Duration, Target Date.
5. **Budget & Cost Breakdown**: Table with Item, Description, Unit Cost, Qty, Total Amount, with a bold summary row.
6. **Terms & Acceptance**: Sign-off block with placeholders for Signature, Name, Title, Date.

### C. Formal Report / Whitepaper
1. **Document Header**: Organization, Document ID / Confidentiality Notice.
2. **Executive Summary / Abstract**.
3. **Key Findings / Highlights**: Callout box or bulleted takeaways.
4. **Detailed Analysis**: Structured sections using H1, H2, H3 with explanatory tables and callouts.
5. **Recommendations & Next Steps**: Numbered action items with assigned owners.

---

## 3. Formatting Rules for Sections

### Headings
- Do not chain consecutive headings without intervening text.
- Capitalize headings appropriately (Title Case for H1/H2, Sentence case for H3).

### Lists (Bullet & Numbered)
- Keep bullet points parallel in grammatical structure (all start with verbs, or all short phrases).
- Use `numbered_list` only for sequential steps, chronological processes, or ranked items.
- For non-sequential items, always use `bullet_list`.

### Tables
- Every table must have clear column headers (`headers` array).
- Column header text should be bold with a dark or distinct background fill (e.g. Slate `#1E293B`, white text).
- Numeric columns (prices, quantities, percentages) should ideally be right-aligned or consistently formatted.
- Avoid wide tables with more than 6-7 columns unless necessary (they overflow page margins).
- Use alternating row shading (zebra) for tables with >5 rows to improve readability.

### Callout Boxes
- Use a `callout` section for tips, warnings, critical notes, or executive summaries.
- Structure: light background fill (`#F1F5F9` for info, `#FEF3C7` for warning), left border accent (`#2563EB` or `#D97706`), italic/indented text.

### Page Breaks
- Use `page_break` deliberately:
  - Before major chapters in long reports.
  - To separate a cover page / title block from body content.
  - Never place two page breaks consecutively.

---

## 4. `create_document` Tool Mapping

Always use the `create_document` tool in Devnuby AI. Map the user's content to the tool's structured sections.

### Document-level options
- `title`, `subtitle`: centered title block at the top of page 1.
- `headerText`: small muted text at the top-right of every page.
- `footerText` + `showPageNumbers`: footer line with "Page X of Y" (page numbers default to on when `footerText` is set).
- `orientation`: `"portrait"` (default) or `"landscape"` for wide tables.

### Section types
- `heading` (`level` 1-4, `text`)
- `paragraph` (`text`, `bold`, `italic`, `color`, `align`) — or `runs` to mix styles in one paragraph: `[{ "text": "Visit " }, { "text": "our site", "link": "https://example.com" }, { "text": " today", "bold": true }]`. Only `http(s)` links become hyperlinks. Do not put markdown (`**bold**`) inside `text`; use `runs` instead.
- `bullet_list` / `numbered_list` (`items`)
- `table` (`headers`, `rows`, `zebra` — alternating shading is on by default; set `false` to disable). The header row repeats on every page.
- `callout` (`title`, `text`, `variant`: `info` | `warning` | `success` | `neutral`)
- `divider` — thin horizontal rule between major blocks.
- `page_break`

### Example

```json
{
  "filename": "Project_Proposal_Acme_Corp.docx",
  "title": "Comprehensive Cloud Migration Strategy",
  "subtitle": "Prepared for Acme Corp • Confidential • November 2026",
  "headerText": "Acme Corp — Cloud Migration Proposal",
  "footerText": "Confidential",
  "showPageNumbers": true,
  "sections": [
    {
      "type": "heading",
      "level": 1,
      "text": "1. Executive Summary"
    },
    {
      "type": "paragraph",
      "text": "This document outlines the strategic roadmap for transitioning legacy workloads to high-availability multi-region cloud infrastructure.",
      "align": "justify"
    },
    {
      "type": "callout",
      "title": "Key Objective",
      "text": "Achieve 99.99% system availability while reducing operational compute expenditure by 28% over 12 months.",
      "variant": "info"
    },
    {
      "type": "heading",
      "level": 2,
      "text": "1.1 Deliverables & Timeline"
    },
    {
      "type": "table",
      "headers": ["Phase", "Scope", "Duration", "Target Date"],
      "rows": [
        ["Phase 1", "Discovery & Architecture Audit", "2 Weeks", "Dec 2026"],
        ["Phase 2", "Core Infrastructure & DB Migration", "4 Weeks", "Jan 2027"],
        ["Phase 3", "Cutover & Performance Tuning", "2 Weeks", "Feb 2027"]
      ]
    }
  ]
}
```

---

## 5. Quality Checklist Before Calling `create_document`

- [ ] Does the filename end with `.docx` and have a descriptive name?
- [ ] Is there a clear title and subtitle?
- [ ] Are headings structured hierarchically (H1 -> H2 -> H3)?
- [ ] Are tables populated with headers and matching column counts across all rows?
- [ ] Is formatting intentional (bold for emphasis, italic for titles/subtitles, callouts for highlights)?
- [ ] Is the document professional, comprehensive, and immediately ready to be presented to clients or employers?
