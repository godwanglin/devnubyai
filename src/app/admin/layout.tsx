import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { AdminNavShell } from "@/components/admin/admin-nav-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ADMIN_LAYOUT] requireAdmin failed:", err);
    redirect("/");
  }

  return <AdminNavShell>{children}</AdminNavShell>;
}
