/* A hook, not a component: no "use client" here. That directive would turn
 * this module into a client reference in the server graph, where the export
 * is no longer a callable function. Call it from client components only. */
import { useEffect, useState } from "react";

/** True once the window has scrolled more than `threshold` px. */
export function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > threshold);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [threshold]);
  return scrolled;
}
