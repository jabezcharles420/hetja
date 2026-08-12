"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError, type DogProfile, type MedicalRecord, type Story } from "@/lib/api";
import DogCard from "@/components/DogCard";
import FeedButton from "@/components/FeedButton";
import SosModal from "@/components/SosModal";
import PawIllustration from "@/components/PawIllustration";
import styles from "./dog.module.css";

export default function DogPage(): React.JSX.Element {
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug ?? "");

  const [dog, setDog] = useState<DogProfile | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sosOpen, setSosOpen] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    const sig = new URLSearchParams(window.location.search).get("s") ?? "";
    try {
      const [profile, medical, storyRes] = await Promise.all([
        api.getDog(slug, sig),
        api.getDogMedical(slug),
        api.getDogStories(slug),
      ]);
      setDog(profile);
      setRecords(medical.records);
      setStories(storyRes.stories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <nav className={styles.topnav} aria-label="Navigation">
        <Link href="/" className={styles.backLink}>
          ← Scan another collar
        </Link>
      </nav>

      {loading && (
        <div className={styles.skeleton} role="status" aria-label="Loading profile">
          <div className={styles.skeletonPhoto} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonPills}>
            <span />
            <span />
            <span />
          </div>
          <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
          <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
        </div>
      )}

      {error && (
        <div className={styles.errorCard} role="alert">
          <PawIllustration size={56} className={styles.errorPaw} />
          <h2 className={styles.errorTitle}>Couldn&apos;t load this profile</h2>
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.retry} onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {dog && (
        <>
          <DogCard dog={dog} records={records} />

          {records.length > 0 && (
            <section className={styles.section} aria-label="Verified medical history">
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Medical history</h2>
                <span className={styles.verifiedBadge}>✓ verified</span>
              </div>
              <ul className={styles.records}>
                {records.map((r) => (
                  <li key={r.hash_curr} className={styles.record}>
                    <span className={styles.recordType}>{r.record_type.replace(/_/g, " ")}</span>
                    {r.vaccine_name && <span className={styles.recordDetail}> · {r.vaccine_name}</span>}
                    {r.vaccine_date && <span className={styles.recordDetail}> · {r.vaccine_date}</span>}
                    {r.abc_date && <span className={styles.recordDetail}> · ABC {r.abc_date}</span>}
                    {r.severity && <span className={styles.recordDetail}> · {r.severity}</span>}
                    {r.diagnosis && <p className={styles.recordNote}>{r.diagnosis}</p>}
                    {r.treatment && <p className={styles.recordNote}>{r.treatment}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {stories.length > 0 && (
            <section className={styles.section} aria-label="Stories from feeders">
              <h2 className={styles.sectionTitle}>Stories from the street</h2>
              {stories.map((s) => (
                <blockquote key={s.id} className={styles.story}>
                  <p className={styles.storyText}>{s.paragraph}</p>
                  <footer className={styles.storyFooter}>
                    — a feeder, v{s.version} · {new Date(s.createdAt).toLocaleDateString()}
                  </footer>
                </blockquote>
              ))}
            </section>
          )}
        </>
      )}

      {dog && (
        <div className={styles.actionBar}>
          <FeedButton dogSlug={dog.slug} />
          <button type="button" className={styles.sos} onClick={() => setSosOpen(true)}>
            SOS
          </button>
        </div>
      )}

      <SosModal open={sosOpen} dogSlug={slug} onClose={() => setSosOpen(false)} />
    </div>
  );
}
