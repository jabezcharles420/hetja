"use client";

/**
 * Route protection is a UX boundary, not a security boundary — see
 * RequireCapability header. The API is the boundary.
 *
 * Reads slug+signature from GET /api/v1/registrations/:slug, so the signature
 * never appears in a URL bar or browser history and the page survives reload.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { RegistrationDetail } from "@/lib/api";
import { buildCollarQrSvg, QR_PHYSICAL_SIZE_MM } from "@/lib/qr";
import RequireCapability from "@/components/RequireCapability";
import styles from "./print.module.css";

function SheetInner({ slug }: { slug: string }): React.JSX.Element {
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRegistration(slug);
      setDetail(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load registration.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className={styles.muted}>Loading…</p>;
  if (error || !detail) {
    return (
      <div className={styles.page}>
        <p role="alert" className={styles.error}>
          {error ?? "Not found."}
        </p>
        <Link className={styles.back} href={`/register/${slug}`}>
          ← Back
        </Link>
      </div>
    );
  }

  const qr = buildCollarQrSvg(detail.collarUrl);

  return (
    <div className={styles.sheetPage}>
      <div className={styles.toolbar}>
        <Link className="h-btn h-btn-ghost" href={`/register/${slug}`}>
          ← Back
        </Link>
        <button type="button" className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className={styles.sheet} role="region" aria-label="Printable collar sheet">
        <div className={styles.cutLines} aria-hidden="true" />

        <div className={styles.qrWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr.svg }} />
        </div>

        <p className={`h-plate ${styles.plate}`} style={{ fontVariantNumeric: "var(--h-num-tabular)" as never }}>
          {detail.slug}
        </p>

        <p className={styles.meta}>
          Ward {detail.wardId} · {detail.slug} · {detail.collarUrl}
        </p>
        <p className={styles.selfCheck}>
          {qr.label} · {qr.moduleMm.toFixed(3)} mm/module at {QR_PHYSICAL_SIZE_MM} mm · Do not scale below 100%
        </p>

        <p className={styles.note}>Laser-etch onto TPU Shore 95A, 40×40 mm. Cut on the hairlines.</p>
      </div>
    </div>
  );
}

export default function PrintSheet({ slug }: { slug: string }): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <SheetInner slug={slug} />
    </RequireCapability>
  );
}
