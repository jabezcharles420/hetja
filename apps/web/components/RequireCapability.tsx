"use client";

/**
 * Route protection is a UX boundary, not a security boundary.
 *
 * The access token lives in localStorage, and Next middleware runs
 * server-side and sees only cookies and headers, so anything built there
 * either always redirects or never does. This component is a client-side
 * gate that reads GET /feeders/me and either renders its children or
 * redirects to /login. The API is the boundary; this is the courtesy.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ds";
import { api, ApiError } from "@/lib/api";
import styles from "./RequireCapability.module.css";

/** Back here after signing in (same-origin path only; login re-checks). */
function loginHref(): string {
  if (typeof window === "undefined") return "/login";
  return `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/** The mist app frame the gate states share with the register screens. */
function Shell({ title, children }: { title?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <Link href="/me" className={styles.back}>
          Cancel
        </Link>
      </div>
      <div className={`h-container ${styles.body}`}>
        {title && <h1 className={styles.title}>{title}</h1>}
        {children}
      </div>
    </div>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_capability"; role: string }
  | { kind: "ok" };

export default function RequireCapability({
  capability,
  children,
}: {
  capability: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getFeederMe();
        if (cancelled) return;
        const caps: string[] = me.capabilities ?? [];
        const has = caps.includes(capability);
        // Fallback: role-based if capabilities absent.
        const roleHas =
          capability === "register"
            ? ["registrator", "vet", "bmc_officer", "admin"].includes(me.role)
            : has;
        if (has || roleHas) setState({ kind: "ok" });
        else setState({ kind: "no_capability", role: me.role });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED")) {
          setState({ kind: "signed_out" });
        } else {
          // Be honest: we don't know. Treat as signed-out so the user can retry via login,
          // rather than showing a permanent "no capability" error for a transient network blip.
          setState({ kind: "signed_out" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capability]);

  // Every pre-children state sits inside `.h-container`, the same gutter the
  // rest of the site uses: e2e/mobile-layout.spec.ts measures text boxes, and
  // a paragraph carrying its own inline padding once made it flaky.
  if (state.kind === "loading") {
    return (
      <Shell>
        <p className={styles.text} role="status">
          Checking access…
        </p>
      </Shell>
    );
  }

  if (state.kind === "signed_out") {
    return (
      <Shell title="Sign in first.">
        <Card className={styles.card}>
          <p className={styles.text}>Sign in as a feeder to use registration.</p>
          <Button href={loginHref()} fullWidth>
            Sign in
          </Button>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "no_capability") {
    return (
      <Shell title="One more step.">
        <Card className={styles.card}>
          <p className={styles.text}>
            Your account does not have the registrator capability. Tap to enable it (self-serve).
          </p>
          <EnableRegisterButton />
          <p className={styles.meta}>Current role: {state.role}</p>
        </Card>
      </Shell>
    );
  }

  return <>{children}</>;
}

function EnableRegisterButton(): React.JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const elect = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await api.electRegisterSurface();
      // Reload to re-evaluate capabilities.
      window.location.reload();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Could not enable registration.");
      setBusy(false);
    }
  };

  return (
    <>
      <Button fullWidth onClick={() => void elect()} disabled={busy}>
        {busy ? "Enabling…" : "Enable registration"}
      </Button>
      {status && (
        <p role="alert" className={styles.error}>
          {status}
        </p>
      )}
    </>
  );
}
