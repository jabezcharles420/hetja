"use client";

import { useCallback, useState } from "react";
import { api, ApiError, type DogProfile } from "@/lib/api";
import { dogName } from "@/lib/streak";
import { CertificateBar, HealthList } from "./HealthList";
import { currentRecords, vetApi, type DogHealth } from "./vet-api";
import { useOnMount, VetMessage, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * V4 "What everyone sees" as a full screen in the web app: "‹ Rani",
 * "Health", the records, and the certificate bar pinned at the bottom.
 * Opened from V2b's "Health notes"; a vet sees "Confirm and sign" on a
 * feeder's note instead of "Ask a vet to sign".
 */
export default function HealthScreen({ slug, backHref }: { slug: string; backHref?: string }): React.JSX.Element {
  const [load, setLoad] = useState<
    { kind: "loading" } | { kind: "error"; notFound: boolean } | { kind: "ready"; dog: DogProfile | null; health: DogHealth }
  >({ kind: "loading" });

  const fetchAll = useCallback(async () => {
    try {
      const [health, dog] = await Promise.all([vetApi.getHealth(slug), api.getDog(slug).catch(() => null)]);
      setLoad({ kind: "ready", dog, health });
    } catch (err) {
      setLoad({ kind: "error", notFound: err instanceof ApiError && err.status === 404 });
    }
  }, [slug]);

  useOnMount(() => void fetchAll());

  const back = backHref ?? `/vet/dogs/${slug}`;
  if (load.kind === "loading") return <VetMessage back="Back" href={back} lead="Loading." role="status" />;
  if (load.kind === "error") {
    return (
      <VetMessage back="Back" href={back} title={load.notFound ? "No dog has this code." : "Hetja could not be reached."} lead={load.notFound ? undefined : "Check your connection and try again."}>
        {!load.notFound && (
          <button type="button" className={`${styles.textLink} ${styles.more}`} onClick={() => void fetchAll()}>
            Try again
          </button>
        )}
      </VetMessage>
    );
  }

  const { dog, health } = load;
  const name = dogName(dog?.name ?? null);
  const records = currentRecords(health.records);
  const vet = health.viewerIsVet;
  return (
    <div className={styles.page}>
      <VetTop back={name} href={back} />
      <div className={styles.body}>
        <h1 className={styles.title}>Health</h1>
        <div className={styles.healthWrap}>
          <HealthList
            slug={slug}
            name={dog?.name ?? null}
            wardId={dog?.wardId ?? null}
            records={records}
            confirmHref={vet ? (r) => `/vet/dogs/${slug}/sign?note=${encodeURIComponent(r.id)}&kind=${r.kind === "sterilisation" ? "sterilisation" : r.kind === "vaccination" ? "vaccination" : "treatment"}` : undefined}
          />
        </div>
      </div>
      {records.some((r) => r.status === "vet_signed") && (
        <div className={styles.footer}>
          <CertificateBar slug={slug} name={dog?.name ?? null} wardId={dog?.wardId ?? null} records={records} />
        </div>
      )}
    </div>
  );
}
