import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const emailArg = process.argv[2];
  const roleArg = process.argv[3] || "admin";

  if (!emailArg) {
    console.error("Usage: tsx scripts/promote-user.ts <email> [role: admin|user]");
    console.error("Example: npm run user:promote -- user@example.com admin");
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  if (!["admin", "user"].includes(roleArg)) {
    console.error(`Invalid role "${roleArg}". Must be "admin" or "user".`);
    process.exit(1);
  }

  const existing = await db.user.findUnique({
    where: { email },
    include: { plan: true },
  });

  if (!existing) {
    console.error(`User with email "${email}" not found.`);
    console.error("Please have the user log in once via Google OAuth first, then re-run this script.");
    process.exit(1);
  }

  const updated = await db.user.update({
    where: { id: existing.id },
    data: { role: roleArg },
  });

  console.log(`[OK] User ${updated.email} (${updated.publicId}) updated: role = "${updated.role}"`);
}

main()
  .catch((err) => {
    console.error("[ERROR]", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
