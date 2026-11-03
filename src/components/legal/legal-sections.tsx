import React from "react";
import type { LegalSectionItem } from "@/lib/legal/settings";

/** Renders admin-managed legal sections; blank lines in a body split paragraphs. */
export function LegalSections({ sections }: { sections: LegalSectionItem[] }) {
  return (
    <div className="space-y-7">
      {sections.map((section, idx) => (
        <section key={idx} className="space-y-2">
          <h2 className="text-sm sm:text-base font-semibold text-[var(--ink)]">{section.title}</h2>
          {section.body
            .split(/\n\s*\n/)
            .filter((p) => p.trim())
            .map((paragraph, pIdx) => (
              <p key={pIdx} className="leading-relaxed whitespace-pre-line">
                {paragraph.trim()}
              </p>
            ))}
        </section>
      ))}
    </div>
  );
}
