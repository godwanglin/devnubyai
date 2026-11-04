/**
 * Makes one user go through onboarding again: clears onboarded_at (answers are kept
 * as defaults) and drops their cached /me so the app notices right away.
 * Run with: npx tsx scripts/reset-onboarding.ts "<name or email>" [--apply]
 * Without --apply it only lists the matching users.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { redis } from "../src/lib/redis/client";

async function main() {
  const query = process.argv[2]?.trim();
  const apply = process.argv.includes("--apply");
  if (!query) throw new Error('Usage: reset-onboarding.ts "<name or email>" [--apply]');

  const users = await db.user.findMany({
    where: {
      OR: [
        { name: { equals: query, mode: "insensitive" } },
        { email: { equals: query.toLowerCase() } },
      ],
    },
    select: { id: true, name: true, email: true, preferences: { select: { onboardedAt: true } } },
  });

  for (const u of users) {
    console.log(`- id=${u.id} ${u.name} <${u.email}> onboardedAt=${u.preferences?.onboardedAt?.toISOString() ?? "null"}`);
  }
  if (users.length !== 1) {
    console.log(users.length === 0 ? "No matching user." : "More than one match: pass the email instead.");
    return;
  }
  if (!apply) {
    console.log("Dry run. Re-run with --apply to reset.");
    return;
  }

  const user = users[0];
  await db.userPreference.updateMany({ where: { userId: user.id }, data: { onboardedAt: null } });
  await redis?.del(`cache:user:${user.id}:me`);
  console.log(`Reset onboarding for ${user.name} <${user.email}>.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    redis?.disconnect();
  });
