/**
 * Every onboarding option must have a label in both locales.
 * Run with: npx tsx scripts/check-onboarding-labels.ts
 */
import { readFileSync } from "node:fs";
import { ONBOARDING_INTERESTS, ONBOARDING_ROLES, ROLE_INTERESTS } from "../src/lib/onboarding/options";

let missing = 0;
for (const locale of ["id", "en"]) {
  const dict = JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8"));
  for (const { id } of ONBOARDING_ROLES) {
    if (!dict.onboarding.roles[id]) (missing++, console.log(`${locale}: roles.${id} missing`));
  }
  for (const { id } of ONBOARDING_INTERESTS) {
    if (!dict.onboarding.interests[id]) (missing++, console.log(`${locale}: interests.${id} missing`));
  }
}
for (const [role, ids] of Object.entries(ROLE_INTERESTS)) {
  console.log(`${role}: ${ids.length} options${new Set(ids).size !== ids.length ? " (DUPLICATES)" : ""}`);
}
console.log(missing === 0 ? "All labels present." : `${missing} labels missing.`);
process.exitCode = missing === 0 ? 0 : 1;
