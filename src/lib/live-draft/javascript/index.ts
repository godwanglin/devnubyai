import type { DraftSection } from "../types";
import { JsInterpreter } from "./interpreter";
import { DraftJsLibrary } from "./library";
import { parseJsProgram } from "./parser";

/** Draft sections of a (possibly half-written) `docx` or pptxgenjs Node script. */
export function buildJsDraftSections(code: string): DraftSection[] {
  const lib = new DraftJsLibrary();
  new JsInterpreter(lib).run(parseJsProgram(code));
  return lib.buildSections();
}
