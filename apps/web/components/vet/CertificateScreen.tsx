"use client";

import { useCallback, useState } from "react";
import { api, ApiError, getAccessToken, type DogProfile } from "@/lib/api";
import { dogName } from "@/lib/streak";
import { certificateRows, collarLine, downloadCertificate } from "./certificate-pdf";
import { HealthList } from "./HealthList";
import { vetApi, type HealthRecord } from "./vet-api";
import { useOnMount, VetMessage, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * The vaccination certificate's own page (designed), where the collar page's
 * "Vaccination certificate for rescues and adoptions · PDF" link lands.
 * Public, like the health list: it shows the vet-signed records it will
 * print, and "Download PDF" builds the file in the browser.
 */
export default function CertificateScreen({ slug }: { slug: string }): React.JSX.Element {
  const [load, setLoad] = useState<{ kind: "loading" } | { kind: "error"; notFound: boolean } | { kind: "ready"; dog: DogProfile | null; rows: HealthRecord[]; collarNo: string | null }>({
    kind: "loading",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [health, dog] = await Promise.all([vetApi.getHealth(slug), api.getDog(slug).catch(() => null)]);
      const collarNo = getAccessToken() ? await vetApi.collarNo(slug, dog) : null;
      setLoad({ kind: "ready", dog, rows: certificateRows(health.records), collarNo });
    } catch (err) {
      setLoad({ kind: "error", notFound: err instanceof ApiError && err.status === 404 });
    }
  }, [slug]);

  useOnMount(() => void fetchAll());

  if (load.kind === "loading") return <VetMessage back="Back" href={`/d/${slug}`} lead="Loading." role="status" />;
  if (load.kind === "error") {
    return (
      <VetMessage
        back="Back"
        href={`/d/${slug}`}
        title={load.notFound ? "No dog has this code." : "Hetja could not be reached."}
        lead={load.notFound ? undefined : "Check your connection and try again."}
      />
    );
  }

  const { dog, rows, collarNo } = load;
  const name = dogName(dog?.name ?? null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadCertificate({ slug, name: dog?.name ?? null, wardId: dog?.wardId ?? null, records: rows, collarNo });
    } catch {
      setError("The certificate couldn't be made on this phone. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${styles.page} ${styles.certPage}`}>
      <VetTop back={name} href={`/d/${slug}`} />
      <div className={styles.body}>
        <h1 className={styles.title}>Vaccination certificate</h1>
        <p className={styles.hint}>{collarLine(slug, collarNo)}</p>
        <p className={styles.lead}>
          {rows.length
            ? `For rescues and adoptions: ${name}'s vet-signed records, with each vet's name and council number. Care that feeders noted themselves is left off.`
            : `${name} has no vet-signed records yet, so there is nothing to certify. A vet can sign one from the Vet tab.`}
        </p>
        {rows.length > 0 && (
          <div className={styles.healthWrap}>
            <HealthList slug={slug} name={dog?.name ?? null} wardId={dog?.wardId ?? null} records={rows} />
          </div>
        )}
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <div className={styles.footer}>
          <button type="button" className={styles.dark} onClick={() => void go()} disabled={busy} aria-busy={busy || undefined}>
            Download PDF
          </button>
        </div>
      )}
    </div>
  );
}
