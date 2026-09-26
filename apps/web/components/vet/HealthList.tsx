"use client";

import Link from "next/link";
import { useState } from "react";
import type { HealthRecord } from "./vet-api";
import { recordLine, signerLine } from "./vet-copy";
import { downloadCertificate } from "./certificate-pdf";
import styles from "./vet.module.css";

/**
 * V4 "Health" (design v7), the web app's version: what a feeder or a
 * stranger sees. Vet-signed rows carry the "✓ Vet signed" badge, the dates
 * and the signer line ("Dr. Farhan Qureshi · MSVC 5190 · Raksharab
 * RB2409"; a government vet says "Government vet · free"). Feeder-noted rows
 * carry "Feeder noted", who added it, and, for a signed-in feeder, "Ask a
 * vet to sign". The collar page (/d/) draws its own copy in apps/scan.
 *
 * The badge is the API's: a feeder can't create or edit "Vet signed".
 */

export interface HealthListProps {
  slug: string;
  name: string | null;
  wardId: string | null;
  records: HealthRecord[];
  /** A signed-in feeder of the dog: offers "Ask a vet to sign". */
  canAsk?: boolean;
  onAsk?: (r: HealthRecord) => Promise<void>;
  /** A verified vet: feeder-noted rows link to signing them. */
  confirmHref?: (r: HealthRecord) => string;
  /** Show the certificate bar (the V4 screen pins it; N15 shows it inline). */
  certificate?: boolean;
  /** Card surface: the board's mist cards on white, or white cards on mist (N15). */
  surface?: "white" | "mist";
}

export function HealthCard({
  r,
  canAsk,
  onAsk,
  confirmHref,
}: {
  r: HealthRecord;
  canAsk?: boolean;
  onAsk?: (r: HealthRecord) => Promise<void>;
  confirmHref?: (r: HealthRecord) => string;
}): React.JSX.Element {
  const [state, setState] = useState<"idle" | "busy" | "asked" | "failed">(r.requestOpen ? "asked" : "idle");
  const signed = r.status === "vet_signed";
  const line = recordLine(r);
  const by = signed ? signerLine(r) : "";
  const ask = async () => {
    if (!onAsk || state === "busy") return;
    setState("busy");
    try {
      await onAsk(r);
      setState("asked");
    } catch {
      setState("failed");
    }
  };
  return (
    <li className={[styles.hcard, signed ? "" : styles.hcardNoted].filter(Boolean).join(" ")}>
      <div className={styles.hhead}>
        <h3 className={styles.htitle}>{r.title}</h3>
        <span className={[styles.badge, signed ? "" : styles.badgeNoted].filter(Boolean).join(" ")}>
          {signed ? "✓ Vet signed" : "Feeder noted"}
        </span>
      </div>
      {line && <p className={styles.hline}>{line}</p>}
      {by && <p className={styles.hsigner}>{by}</p>}
      {!signed && confirmHref && (
        <Link href={confirmHref(r)} className={styles.ask}>
          Confirm and sign
        </Link>
      )}
      {!signed && !confirmHref && canAsk && onAsk && (
        state === "asked" ? (
          <span className={styles.asked} role="status">
            Asked. A vet near you will see it.
          </span>
        ) : (
          <>
            <button type="button" className={styles.ask} onClick={() => void ask()} disabled={state === "busy"} aria-busy={state === "busy" || undefined}>
              Ask a vet to sign
            </button>
            {state === "failed" && (
              <span className={styles.asked} role="alert">
                That didn&rsquo;t go through. Try again.
              </span>
            )}
          </>
        )
      )}
    </li>
  );
}

export function CertificateBar({
  slug,
  name,
  wardId,
  records,
  collarNo,
}: Pick<HealthListProps, "slug" | "name" | "wardId" | "records"> & { collarNo?: string | null }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!records.some((r) => r.status === "vet_signed")) return null;
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadCertificate({ slug, name, wardId, records, collarNo: collarNo ?? null });
    } catch {
      setError("The certificate couldn't be made on this phone. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={styles.cert} onClick={() => void go()} aria-busy={busy || undefined}>
        <span className={styles.certText}>Vaccination certificate for rescues and adoptions</span>
        <span className={styles.certPdf}>PDF</span>
      </button>
      {error && (
        <p className={styles.footAlert} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** The board's order: vet-signed first, then feeder notes; newest first within each. */
export function healthOrder(records: HealthRecord[]): HealthRecord[] {
  return [...records].sort(
    (a, b) =>
      (a.status === "vet_signed" ? 0 : 1) - (b.status === "vet_signed" ? 0 : 1) || String(b.date ?? "").localeCompare(String(a.date ?? "")),
  );
}

export function HealthList({ records: raw, canAsk, onAsk, confirmHref }: HealthListProps): React.JSX.Element {
  const records = healthOrder(raw);
  if (records.length === 0) {
    return <p className={styles.healthEmpty}>Nothing on the record yet. A vet can sign a vaccination or sterilisation here.</p>;
  }
  return (
    <ul className={styles.health}>
      {records.map((r) => (
        <HealthCard key={r.id} r={r} canAsk={canAsk} onAsk={onAsk} confirmHref={confirmHref} />
      ))}
    </ul>
  );
}
