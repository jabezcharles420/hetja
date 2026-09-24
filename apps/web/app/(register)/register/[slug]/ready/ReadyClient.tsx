"use client";

/**
 * Screen 11, Collar ready (design v4). Route protection is a UX boundary, not
 * a security boundary (see RequireCapability); the API is the boundary.
 *
 * The signed collar URL comes from GET /registrations/:slug (behind auth), so
 * the signature never sits in a URL bar. "Print collar" and "Save as PDF" both
 * open the print dialog; the print stylesheet shows the tag alone, with the QR
 * at its physical 40 mm. The TPU laser sheet stays at /register/[slug]/print.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, StickyFooter, collarGroups } from "@/components/ds";
import { api, ApiError, type RegistrationDetail } from "@/lib/api";
import { buildCollarQrSvg } from "@/lib/qr";
import RequireCapability from "@/components/RequireCapability";
import styles from "./ready.module.css";

export function readyTitle(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `${n} has a code.` : "Your dog has a code.";
}

export function tagLine(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `${n} · Scan me if I look lost` : "Scan me if I look lost";
}

function ReadyInner({ slug }: { slug: string }): React.JSX.Element {
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.getRegistration(slug));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this collar.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const qr = useMemo(() => (detail ? buildCollarQrSvg(detail.collarUrl) : null), [detail]);

  if (!detail || !qr) {
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {error ? (
            <>
              <h1 className={styles.title}>Collar not found.</h1>
              <p className={styles.lead} role="alert">
                {error}
              </p>
              <Link href="/register" className={styles.link}>
                Back to your dogs ›
              </Link>
            </>
          ) : (
            <p className={styles.lead} role="status">
              Loading…
            </p>
          )}
        </div>
      </div>
    );
  }

  const print = () => window.print();

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <h1 className={styles.title}>{readyTitle(detail.name)}</h1>
        <p className={styles.lead}>
          Print it on waterproof paper, laminate it, and loop it on a soft collar. Not too tight: two fingers under.
        </p>

        <div className={styles.tag} data-print-tag="true">
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <div className={styles.code} aria-label={`Collar code ${detail.slug.split("").join(" ")}`}>
            {collarGroups(detail.slug).map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
          <div className={styles.tagLine}>{tagLine(detail.name)}</div>
        </div>

        {detail.status === "pending_activation" && (
          <Link href={`/register/${slug}`} className={styles.next}>
            Collar on the dog? Switch the profile on ›
          </Link>
        )}
      </div>

      <StickyFooter background="mist" className={styles.footer}>
        <Button fullWidth onClick={print}>
          Print collar
        </Button>
        <button
          type="button"
          className={styles.pdf}
          onClick={print}
          title="Opens the print dialog. Choose Save as PDF as the printer."
        >
          Save as PDF
        </button>
      </StickyFooter>
    </div>
  );
}

export default function ReadyClient({ slug }: { slug: string }): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <ReadyInner slug={slug} />
    </RequireCapability>
  );
}
