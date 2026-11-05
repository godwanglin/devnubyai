import type { DraftSection } from "../types";
import { PyInterpreter } from "./interpreter";
import { DraftPythonLibrary } from "./library";
import { parsePythonProgram } from "./parser";

/** Draft sections of a (possibly half-written) reportlab / openpyxl script. */
export function buildPythonDraftSections(code: string): DraftSection[] {
  const program = parsePythonProgram(code);
  const lib = new DraftPythonLibrary();
  const interpreter = new PyInterpreter(lib);
  interpreter.run(program);
  // `def main(): ...` whose call at the bottom has not been written yet
  interpreter.runUncalledEntryPoints();
  return lib.buildSections();
}
