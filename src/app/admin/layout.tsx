import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { AdminNavShell } from "@/components/admin/admin-nav-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let adminUser;
  try {
    adminUser = await requireAdmin();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ADMIN_LAYOUT] requireAdmin failed:", err);
    redirect("/");
  }

  const initials = adminUser.name
    ? adminUser.name
        .trim()
        .split(/\s+/)
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "AD";

  const serializedUser = {
    id: adminUser.publicId || String(adminUser.id),
    name: adminUser.name || "Admin",
    email: adminUser.email || "",
    initials: initials || "AD",
    avatarUrl: adminUser.avatarUrl,
    role: adminUser.role,
    status: adminUser.status,
    planLabel: adminUser.plan?.name ?? "Admin",
  };

  return <AdminNavShell user={serializedUser}>{children}</AdminNavShell>;
}
