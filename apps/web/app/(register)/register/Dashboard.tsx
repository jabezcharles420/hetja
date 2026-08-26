"use client";

/**
 * Route protection is a UX boundary, not a security boundary.
 *
 * The access token lives in localStorage; Next middleware runs server-side
 * and sees only cookies/headers, so it either always redirects or never does.
 * This component is a client-side gate reading GET /feeders/me. The API is
 * the boundary — this is the courtesy.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { RegistrationSummary } from "@/lib/api";
import RequireCapability from "@/components/RequireCapability";
import PageHeader from "@/components/PageHeader";
import contentStyles from "@/components/Content.module.css";

function daysLeft(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function Countdown({ expiresAt }: { expiresAt?: string }): React.JSX.Element | null {
  const d = daysLeft(expiresAt);
  if (d === null) return null;
  if (d <= 0) return <span style={{ color: "var(--h-accent)", fontWeight: 600 }}>Expired — scan still reactivates</span>;
  if (d <= 7) return <span style={{ color: "var(--h-accent)", fontWeight: 600 }}>{d} days left</span>;
  return <span>{d} days left</span>;
}

function DashboardInner(): React.JSX.Element {
  const [regs, setRegs] = useState<RegistrationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRegistrations();
      setRegs(res.registrations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load registrations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        kicker="Register"
        title="Your registrations"
        intro="A registration is inert until you print the QR, laser-etch it, and scan it on the dog. The countdown is the channel that works on iOS — Web Push needs add-to-home-screen and the native shell does not exist yet, so the dashboard is the reminder."
      />

      <section className={`${contentStyles.section} h-container`}>
        <div style={{ display: "flex", gap: "var(--h-s3)", flexWrap: "wrap", marginBottom: "var(--h-s5)" }}>
          <Link className="h-btn h-btn-primary" href="/register/new">
            Register a dog
          </Link>
          <button type="button" className="h-btn h-btn-ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>

        {loading && <p style={{ color: "var(--h-ink-muted)" }}>Loading…</p>}
        {error && (
          <p role="alert" style={{ color: "var(--h-accent)", fontWeight: 600 }}>
            {error}
          </p>
        )}

        {regs !== null && regs.length === 0 && (
          <div className={contentStyles.card} style={{ maxWidth: 560 }}>
            <h3 className={contentStyles.cardTitle}>No registrations yet</h3>
            <p className={contentStyles.cardText}>File one and you’ll get a signed QR to print and attach. Two pending at a time.</p>
          </div>
        )}

        {regs !== null && regs.length > 0 && (
          <div style={{ display: "grid", gap: "var(--h-s4)" }}>
            {regs.map((r) => (
              <article key={r.slug} className={contentStyles.card} style={{ display: "flex", flexDirection: "column", gap: "var(--h-s2)" }}>
                <div style={{ display: "flex", gap: "var(--h-s3)", flexWrap: "wrap", alignItems: "baseline" }}>
                  <Link href={`/register/${r.slug}`} style={{ fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
                    {r.slug}
                  </Link>
                  <span style={{ fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {r.status}
                  </span>
                  <span style={{ fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)" }}>Ward {r.wardId}</span>
                </div>
                {r.status === "pending_activation" && (
                  <p style={{ fontSize: "var(--h-t-sm)", fontVariantNumeric: "var(--h-num-tabular)" }}>
                    <Countdown expiresAt={r.expiresAt} />
                    {r.registeredAt && r.expiresAt && (
                      <span style={{ color: "var(--h-ink-muted)", marginLeft: 8 }}>
                        Registered {new Date(r.registeredAt).toLocaleDateString()} · expires {new Date(r.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                )}
                {r.status !== "pending_activation" && r.registeredAt && (
                  <p style={{ fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)" }}>
                    Registered {new Date(r.registeredAt).toLocaleDateString()}
                  </p>
                )}
                <div style={{ display: "flex", gap: "var(--h-s3)" }}>
                  <Link className="h-btn h-btn-ghost" href={`/register/${r.slug}`}>
                    Details
                  </Link>
                  <Link className="h-btn h-btn-ghost" href={`/register/${r.slug}/print`}>
                    Print sheet
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}

        <div style={{ marginTop: "var(--h-s7)", maxWidth: 560, color: "var(--h-ink-muted)", fontSize: "var(--h-t-sm)", lineHeight: 1.6 }}>
          <p>
            Reminders are a <strong style={{ color: "var(--h-ink)" }}>days-left countdown</strong> on this page, not email. We do not store your
            email address (INVARIANT 3) and Web Push on iOS needs add-to-home-screen — the native shell does not exist yet — so this dashboard is
            the channel that works everywhere.
          </p>
        </div>
      </section>
    </>
  );
}

export default function Dashboard(): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <DashboardInner />
    </RequireCapability>
  );
}
