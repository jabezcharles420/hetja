import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Hetja Admin",
  description: "The Hetja team's admin portal: vets, NGOs, avatars, merges, SOS and the audit log.",
  robots: { index: false, follow: false },
};

/**
 * /admin/** (design v7 A1 to A7): desktop only, at admin.hetja.in (Caddy
 * routes that host here) and hetja.in/admin. ChromeShell draws no chrome for
 * it (kind "admin"); the shell draws the sidebar, the gate states and the
 * "Admin works on a laptop" page. Client-rendered: the session is in
 * localStorage.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <AdminShell>{children}</AdminShell>;
}
