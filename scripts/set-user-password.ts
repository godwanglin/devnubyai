import "dotenv/config";
import { db } from "../src/lib/db";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

async function main() {
  const email = (process.argv[2] || "denisprasetio060@gmail.com").toLowerCase().trim();
  const password = process.argv[3] || "Admin123";

  console.log(`Setting password for ${email}...`);

  const user = await db.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.error(`User with email "${email}" not found.`);
    process.exit(1);
  }

  const hash = hashPassword(password);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: hash },
  });

  console.log(`[OK] Password set successfully for user: ${user.email} (id: ${user.id.toString()})`);
  const match = verifyPassword(password, hash);
  console.log(`[OK] Immediate verification match: ${match}`);
}

main()
  .catch((err) => {
    console.error("[ERROR]", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
