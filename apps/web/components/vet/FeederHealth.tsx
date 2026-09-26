"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Sheet } from "@/components/ds";
import { ApiError } from "@/lib/api";
import { CertificateBar, HealthList } from "./HealthList";
import { longDate, today } from "./vet-copy";
import { vetApi, type HealthRecord } from "./vet-api";
import styles from "./vet.module.css";

/**
 * The feeder's side of signing (design v7 V4), dropped into N15
 * (/me/dogs/<slug>) as one self-contained section: the dog's health list,
 * "Ask a vet to sign" on each feeder-noted row, the certificate PDF, and
 * "Note care", which adds a "Feeder noted" record. Feeders log care
 * themselves; only a verified vet can turn a note into "Vet signed".
 */

type NoteType = "deworming" | "vaccination" | "sterilisation" | "treatment" | "other";

const NOTE_TYPES: { value: NoteType; label: string }[] = [
  { value: "deworming", label: "Deworming" },
  { value: "vaccination", label: "Vaccination" },
  { value: "sterilisation", label: "Sterilisation" },
  { value: "treatment", label: "Treatment" },
  { value: "other", label: "Something else" },
];

export default function FeederHealth({ slug, name, wardId }: { slug: string; name: string | null; wardId: string | null }): React.JSX.Element | null {
  const ids = useId();
  const [records, setRecords] = useState<HealthRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<NoteType>("deworming");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      setRecords((await vetApi.getHealth(slug)).records);
    } catch {
      setRecords((r) => r ?? []);
    }
  }, [slug]);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const needsTitle = type === "treatment" || type === "other" || type === "vaccination";

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await vetApi.addFeederNote(slug, {
        type,
        ...(needsTitle && title.trim() ? { title: title.trim() } : {}),
        date,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setOpen(false);
      setTitle("");
      setNote("");
      await fetchHealth();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "Only feeders of this dog can note care."
          : err instanceof ApiError && err.status === 400
            ? "Something wasn't accepted. Check the date and try again."
            : "Hetja could not be reached. Nothing was saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (records === null) return null;

  return (
    <section className={styles.feederHealth} aria-labelledby={`${ids}-h`}>
      <div className={styles.feederHealthHead}>
        <h2 className={styles.feederHealthTitle} id={`${ids}-h`}>
          Health
        </h2>
        <button type="button" className={styles.noteBtn} onClick={() => setOpen(true)}>
          Note care
        </button>
      </div>
      <HealthList
        slug={slug}
        name={name}
        wardId={wardId}
        records={records}
        canAsk
        onAsk={async (r) => {
          await vetApi.askToSign(slug, r.id);
        }}
      />
      <CertificateBar slug={slug} name={name} wardId={wardId} records={records} />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Note care yourself"
        footer={
          <>
            {error && (
              <p className={styles.footAlert} role="alert">
                {error}
              </p>
            )}
            <button type="button" className={styles.dark} onClick={() => void save()} disabled={busy || !date || (type !== "deworming" && type !== "sterilisation" && !title.trim())} aria-busy={busy || undefined}>
              Save as Feeder noted
            </button>
          </>
        }
      >
        <p className={styles.sheetText}>It shows as Feeder noted. You can ask a vet to sign it afterwards.</p>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>What</span>
          <select className={styles.input} value={type} onChange={(e) => setType(e.target.value as NoteType)}>
            {NOTE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {needsTitle && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{type === "vaccination" ? "Vaccine" : "What for"}</span>
            <input
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              placeholder={type === "vaccination" ? "Anti-rabies" : "Wound on the paw"}
            />
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>When</span>
          <input className={styles.input} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-describedby={`${ids}-d`} />
          <span className={styles.hint} id={`${ids}-d`}>
            {date ? longDate(date) : ""}
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Note, if any</span>
          <input className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} />
        </label>
      </Sheet>
    </section>
  );
}
