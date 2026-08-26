"use client";

/**
 * Route protection is a UX boundary, not a security boundary.
 *
 * The access token lives in localStorage, and Next middleware runs
 * server-side and sees only cookies and headers — so anything built there
 * either always redirects or never does. This component is a client-side
 * gate that reads GET /feeders/me and either renders its children or
 * redirects to /login. The API is the boundary; this is the courtesy.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";

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

  if (state.kind === "loading") {
    return <p style={{ padding: "var(--h-s6) var(--h-gutter)" }}>Checking access…</p>;
  }

  if (state.kind === "signed_out") {
    return (
      <div style={{ padding: "var(--h-s6) var(--h-gutter)", maxWidth: 560 }}>
        <p style={{ marginBottom: 12 }}>Sign in as a feeder to use registration.</p>
        <Link className="h-btn h-btn-primary" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  if (state.kind === "no_capability") {
    return (
      <div style={{ padding: "var(--h-s6) var(--h-gutter)", maxWidth: 560 }}>
        <p style={{ marginBottom: 12 }}>
          Your account does not have the registrator capability. Tap to enable it (self-serve).
        </p>
        <EnableRegisterButton />
        <p style={{ marginTop: 8, color: "var(--h-ink-muted)", fontSize: "var(--h-t-sm)" }}>
          Current role: {state.role}
        </p>
      </div>
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
      <button type="button" className="h-btn h-btn-primary" onClick={() => void elect()} disabled={busy}>
        {busy ? "Enabling…" : "Enable registration"}
      </button>
      {status && (
        <p role="alert" style={{ marginTop: 8, color: "var(--h-accent)", fontSize: "var(--h-t-sm)" }}>
          {status}
        </p>
      )}
    </>
  );
}
