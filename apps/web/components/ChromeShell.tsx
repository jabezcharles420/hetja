"use client";

import { usePathname } from "next/navigation";
import Header from "./Header";
import Footer from "./Footer";
import { BottomNav } from "./BottomNav";
import { InstallBanner } from "./InstallBanner";

/**
 * The scanned dog profile (§3.3) needs the whole viewport for one decision:
 * a stranger under stress should see the dog and a single primary action,
 * not a 3-link header nav, a 3-item bottom nav and an install banner all
 * competing for the same screen. This is the one surface that suppresses
 * the global chrome.
 *
 * Footer is deliberately excluded from the suppression — it sits below all
 * page content and never competes with the primary action in the bottom
 * third of the viewport.
 */
function isBareRoute(pathname: string): boolean {
  return pathname.startsWith("/dog/");
}

export function ChromeShell({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname() ?? "/";
  const bare = isBareRoute(pathname);

  return (
    <>
      {!bare && <Header />}
      <main className={bare ? "h-main h-main-bare" : "h-main"}>{children}</main>
      {!bare && <InstallBanner />}
      {!bare && <BottomNav />}
      <Footer />
    </>
  );
}
