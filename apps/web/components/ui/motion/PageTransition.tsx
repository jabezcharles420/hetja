"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { prefersReducedMotion } from "./env";
import styles from "./PageTransition.module.css";

/**
 * Route transitions for the Next 14 App Router, as progressive enhancement.
 *
 * Why not CSS `@view-transition { navigation: auto }`: that opts in
 * cross-DOCUMENT (MPA) navigations only. App Router links are client-side
 * (same-document), so they need `document.startViewTransition()` around the
 * router update. Next 14 has no built-in hook for it (React's
 * <ViewTransition> and `experimental.viewTransition` arrived with Next 15.2 /
 * React canary), so this module wraps `router.push` itself.
 *
 * How the "done" signal works: App Router commits the new tree and then
 * updates the URL in the same commit, so the transition callback resolves as
 * soon as `location` matches the target (checked each frame), with a 1.5 s
 * cap so a slow route never freezes the old snapshot for long.
 *
 * Browsers without the API (and reduced motion) navigate instantly with a
 * plain `router.push`. The default cross-fade is the browser's own; no
 * global CSS is needed.
 */

type StartViewTransition = (cb: () => Promise<void> | void) => { finished: Promise<void> };

function startVT(): StartViewTransition | null {
  if (typeof document === "undefined" || prefersReducedMotion()) return null;
  const d = document as Document & { startViewTransition?: StartViewTransition };
  return typeof d.startViewTransition === "function" ? d.startViewTransition.bind(d) : null;
}

function waitForUrl(href: string, capMs = 1500): Promise<void> {
  const target = new URL(href, window.location.href);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = (): void => {
      const here = window.location;
      const arrived = here.pathname === target.pathname && here.search === target.search;
      if (arrived || performance.now() - t0 > capMs) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** `push(href)` that runs inside a view transition when the browser can. */
export function useTransitionRouter(): { push: (href: string, opts?: { scroll?: boolean }) => void } {
  const router = useRouter();
  const push = useCallback(
    (href: string, opts?: { scroll?: boolean }) => {
      const vt = startVT();
      if (!vt) {
        router.push(href, opts);
        return;
      }
      vt(() => {
        router.push(href, opts);
        return waitForUrl(href);
      });
    },
    [router],
  );
  return { push };
}

export type TransitionLinkProps = ComponentProps<typeof Link> & { children?: ReactNode };

/**
 * <TransitionLink> is a drop-in next/link. Plain left clicks on same-origin
 * string hrefs go through a view transition; modified clicks (new tab,
 * download), external links and `target` links behave exactly like <Link>.
 */
export function TransitionLink({ onClick, href, target, ...rest }: TransitionLinkProps): React.JSX.Element {
  const { push } = useTransitionRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e);
    if (e.defaultPrevented || typeof href !== "string") return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (target && target !== "_self") return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (!startVT()) return; // let <Link> do its normal thing
    e.preventDefault();
    push(url.pathname + url.search + url.hash, { scroll: rest.scroll ?? true });
  };
  return <Link href={href} target={target} onClick={handle} {...rest} />;
}

/**
 * <RouteFade> is the no-API fallback: a short fade-and-rise when a route
 * mounts. Put it in an `app/.../template.tsx` (templates remount on every
 * navigation, layouts do not). Reduced motion: no animation.
 */
export function RouteFade({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={styles.fade}>{children}</div>;
}
