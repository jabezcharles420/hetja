"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError, type DogProfile, type MedicalRecord, type Story } from "@/lib/api";
import DogCard from "@/components/DogCard";
import FeedButton from "@/components/FeedButton";
import SosModal from "@/components/SosModal";
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
      <nav className={styles.topnav}>
        <Link href="/">← Scan another collar</Link>
      </nav>

      {loading && <p className={styles.state}>Loading profile…</p>}

      {error && <p className={styles.error}>{error}</p>}

      {dog && (
        <>
          <DogCard dog={dog} />

          <div className={styles.actions}>
            <FeedButton dogSlug={dog.slug} />
            <button type="button" className={styles.sos} onClick={() => setSosOpen(true)}>
              SOS — needs help
            </button>
          </div>

          {records.length > 0 && (
            <section className={styles.section} aria-label="Verified medical history">
              <h2>Medical history</h2>
              <ul className={styles.records}>
                {records.map((r) => (
                  <li key={r.hash_curr} className={styles.record}>
                    <span className={styles.recordType}>{r.record_type.replace(/_/g, " ")}</span>
                    {r.vaccine_name && <span> · {r.vaccine_name}</span>}
                    {r.vaccine_date && <span> · {r.vaccine_date}</span>}
                    {r.abc_date && <span> · ABC {r.abc_date}</span>}
                    {r.diagnosis && <p>{r.diagnosis}</p>}
                    {r.treatment && <p className={styles.muted}>{r.treatment}</p>}
                    {r.severity && <span className={styles.muted}> · severity: {r.severity}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {stories.length > 0 && (
            <section className={styles.section} aria-label="Stories">
              <h2>Stories</h2>
              {stories.map((s) => (
                <blockquote key={s.id} className={styles.story}>
                  <p>{s.paragraph}</p>
                  <footer className={styles.muted}>
                    — feeder, v{s.version} · {new Date(s.createdAt).toLocaleDateString()}
                  </footer>
                </blockquote>
              ))}
            </section>
          )}
        </>
      )}

      <SosModal open={sosOpen} dogSlug={slug} onClose={() => setSosOpen(false)} />
    </div>
  );
}
