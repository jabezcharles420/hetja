"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/ds";
import { ApiError, getAccessToken } from "@/lib/api";
import { ngoApi, type Ngo, type NgoMine, type NgoRole } from "./ngo-api";
import { NgoStatusView } from "./NgoStatusView";
import styles from "./ngo.module.css";

/**
 * Who may see an NGO screen. The API decides what a member may do; this only
 * picks what to draw: signed out (sign in), no NGO (bring one), an
 * application that is not active yet (its status), or the screen itself.
 */

export type NgoLoad =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "error"; message: string }
  | { kind: "ready"; mine: NgoMine };

export function errorWords(err: unknown, fallback = "Could not load this. Try again."): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export function useMyNgo(): { load: NgoLoad; reload: () => void } {
  const [load, setLoad] = useState<NgoLoad>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    if (!getAccessToken()) {
      setLoad({ kind: "signedOut" });
      return;
    }
    ngoApi.getMyNgo().then(
      (mine) => live && setLoad({ kind: "ready", mine }),
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 401) setLoad({ kind: "signedOut" });
        else setLoad({ kind: "error", message: errorWords(err) });
      },
    );
    return () => {
      live = false;
    };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { load, reload };
}

export function Loading({ label = "Loading" }: { label?: string }): React.JSX.Element {
  return (
    <p className={styles.lead} role="status">
      {label}…
    </p>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className={styles.stack10}>
      <p className={styles.error} role="alert">
        {message}
      </p>
      <button type="button" className={`${styles.linkBtn} ${styles.linkStart}`} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function SignedOut({ next }: { next: string }): React.JSX.Element {
  return (
    <div className={styles.stack10}>
      <p className={styles.lead}>Sign in to see your NGO on Hetja.</p>
      <Link className={styles.inkBtn} href={`/login?next=${encodeURIComponent(next)}`}>
        Sign in with email
      </Link>
    </div>
  );
}

/** A focused NGO screen's frame: the 52px header, then the body. */
export function NgoFrame({
  back,
  mist = true,
  trailing,
  children,
}: {
  back: { href: string; label: string };
  mist?: boolean;
  trailing?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={`${styles.page} ${mist ? styles.mist : ""}`}>
      <AppHeader back={{ ...back, history: true }} trailing={trailing} />
      {children}
    </div>
  );
}

/** Members of an active or a paused NGO use the portal; a paused one just gets no new SOS routing. */
export function canUsePortal(ngo: Ngo | null | undefined): ngo is Ngo {
  return !!ngo && (ngo.status === "active" || ngo.status === "paused");
}

/**
 * Renders `children` for a member of an active (or paused) NGO; everything
 * else gets the right screen in the same frame.
 */
export function ActiveNgo({
  next,
  frame,
  children,
}: {
  next: string;
  /** Draw the fallback inside a focused frame with this back link. */
  frame?: { href: string; label: string };
  children: (ngo: Ngo, role: NgoRole | null, mine: NgoMine) => ReactNode;
}): React.JSX.Element {
  const { load, reload } = useMyNgo();
  if (load.kind === "ready" && canUsePortal(load.mine.ngo)) {
    return <>{children(load.mine.ngo, load.mine.role, load.mine)}</>;
  }
  const body = (
    <div className={`h-container ${styles.body}`}>
      {load.kind === "loading" && <Loading />}
      {load.kind === "signedOut" && <SignedOut next={next} />}
      {load.kind === "error" && <LoadError message={load.message} onRetry={reload} />}
      {load.kind === "ready" && !load.mine.ngo && (
        <div className={styles.stack10}>
          <p className={styles.lead}>You are not part of an NGO on Hetja yet.</p>
          <Link className={styles.inkBtn} href="/ngo/register">
            Bring your NGO to Hetja
          </Link>
        </div>
      )}
      {load.kind === "ready" && load.mine.ngo && !canUsePortal(load.mine.ngo) && (
        <NgoStatusView ngo={load.mine.ngo} />
      )}
    </div>
  );
  return frame ? <NgoFrame back={frame}>{body}</NgoFrame> : body;
}

/** Coordinators invite, remove, vouch and dispatch (CONTRACT "Roles and access"). */
export function isCoordinator(role: NgoRole | null): boolean {
  return role === "coordinator";
}
