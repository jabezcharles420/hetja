"use client";

import { useCallback, useId, useState } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ds";
import { ApiError } from "@/lib/api";
import { dogName } from "@/lib/streak";
import { PasskeyError, passkeyMessage, setUpPasskey, signLabel, signWithPasskey } from "./passkey";
import { longDate, recordNoun, withdrawSentence } from "./vet-copy";
import { vetApi, type RecordKind, type RecordPayload, type SignedRecord, type VetProfile } from "./vet-api";
import { useOnMount, useSignedIn, VetMessage, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * V5 "Correct a signed record" (design v7). Signed records can't be edited:
 * a correction is a new record that supersedes the old one, and the old
 * value stays visible, struck through. "Or withdraw it" signs a withdrawal
 * instead: the badge comes off the dog's page and the feeder is told.
 * Both are signed with the passkey, like the original.
 *
 * The board shows one changed field (Batch). Every field of the record is
 * listed here, and each one that changes shows old and new side by side.
 */

type Field = { key: string; label: string; kind: "text" | "date" };

const FIELDS: Record<RecordKind, Field[]> = {
  vaccination: [
    { key: "brand", label: "Brand", kind: "text" },
    { key: "batch", label: "Batch", kind: "text" },
    { key: "date", label: "Given on", kind: "date" },
    { key: "dueOn", label: "Next due", kind: "date" },
  ],
  sterilisation: [
    { key: "date", label: "Done on", kind: "date" },
    { key: "note", label: "Note", kind: "text" },
  ],
  treatment: [
    { key: "date", label: "Treated on", kind: "date" },
    { key: "title", label: "What for", kind: "text" },
    { key: "note", label: "Treatment", kind: "text" },
  ],
};

function kindOf(r: SignedRecord): RecordKind {
  return r.kind === "vaccination" || r.kind === "sterilisation" ? r.kind : "treatment";
}

function valueOf(r: SignedRecord, key: string): string {
  const v = (r as unknown as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** The corrected record, whole: what the vet is signing now. */
export function correctedPayload(r: SignedRecord, edits: Record<string, string>): RecordPayload {
  const get = (k: string) => (k in edits ? edits[k]! : valueOf(r, k));
  const kind = kindOf(r);
  if (kind === "vaccination") {
    return { kind, vaccine: r.title, brand: get("brand"), batch: get("batch"), givenOn: get("date"), nextDue: get("dueOn") || null };
  }
  if (kind === "sterilisation") return { kind, date: get("date"), earNotched: /notch/i.test(get("note")), note: get("note") || null };
  return { kind, date: get("date"), diagnosis: get("title"), treatment: get("note"), nextCheck: null };
}

export default function CorrectScreen({ id }: { id: string }): React.JSX.Element {
  const ids = useId();
  const { toLogin, signedIn } = useSignedIn(`/vet/signatures/${id}`);
  const [load, setLoad] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; record: SignedRecord; vet: VetProfile | null }>({
    kind: "loading",
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"correct" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"corrected" | "withdrawn" | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const fetchRecord = useCallback(async () => {
    try {
      const [record, vet] = await Promise.all([vetApi.getSignature(id), vetApi.getMyVet().catch(() => null)]);
      setNeedsSetup(vet ? !vet.hasPasskey : false);
      setLoad({ kind: "ready", record, vet });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setLoad({
        kind: "error",
        message: err instanceof ApiError && err.status === 404 ? "This record isn't one you signed." : "Hetja could not be reached. Check your connection and try again.",
      });
    }
  }, [id, toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchRecord();
  });

  if (load.kind === "loading") return <VetMessage back="My signatures" href="/vet/signatures" lead="Loading." role="status" />;
  if (load.kind === "error") return <VetMessage back="My signatures" href="/vet/signatures" title="Can't open this record." lead={load.message} role="alert" />;

  const { record } = load;
  const kind = kindOf(record);
  const name = dogName(record.dog.name);
  const fields = FIELDS[kind];
  const changed = fields.filter((f) => f.key in edits && edits[f.key] !== valueOf(record, f.key));
  const locked = record.corrected || record.withdrawn;

  if (done) {
    return (
      <div className={styles.page}>
        <VetTop back="My signatures" href="/vet/signatures" />
        <div className={styles.body}>
          <h1 className={styles.title}>{done === "corrected" ? "Correction signed." : "Record withdrawn."}</h1>
          <p className={styles.lead} role="status">
            {done === "corrected"
              ? `${name}'s page shows the new version. The old one stays in the record, struck through.`
              : `The badge is off ${name}'s page, and ${record.requestedBy ?? `${name}'s feeders`} ${record.requestedBy ? "has" : "have"} been told.`}
          </p>
        </div>
        <div className={styles.footer}>
          <Link href="/vet/signatures" className={styles.dark}>
            Back to My signatures
          </Link>
        </div>
      </div>
    );
  }

  const run = async (what: "correct" | "withdraw") => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      if (needsSetup) {
        await setUpPasskey();
        setNeedsSetup(false);
      }
      await signWithPasskey({
        dogSlug: record.dog.slug,
        payload: what === "correct" ? correctedPayload(record, edits) : { kind: "withdrawal" },
        supersedes: record.id,
        reason: reason.trim() || null,
      });
      setConfirm(false);
      setDone(what === "correct" ? "corrected" : "withdrawn");
    } catch (err) {
      if (err instanceof PasskeyError) {
        if (err.reason === "no-passkey") setNeedsSetup(true);
        setError(passkeyMessage(err));
      } else if (err instanceof ApiError && err.status === 401) toLogin();
      else setError(err instanceof ApiError && err.status === 409 ? "This record was already corrected or withdrawn." : "That didn't go through. Nothing was saved. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const ready = changed.length > 0 && reason.trim().length >= 4 && !locked;

  return (
    <div className={styles.page}>
      <VetTop back="My signatures" href="/vet/signatures" />
      <div className={styles.body}>
        <h1 className={styles.title}>
          Correct {name}&rsquo;s {recordNoun(kind, record.title)} record
        </h1>
        <p className={styles.lead}>Signed records can&rsquo;t be edited. A correction adds a new version and keeps the old one visible, struck through.</p>
        {locked && (
          <p className={styles.reason} role="status">
            {record.withdrawn ? "You withdrew this record." : "This record already has a newer version. Correct that one instead."}
          </p>
        )}

        <div className={styles.rows}>
          {fields.map((f) => {
            const old = valueOf(record, f.key);
            const now = f.key in edits ? edits[f.key]! : old;
            const isChanged = now !== old;
            const show = (v: string) => (f.kind === "date" ? longDate(v) : v) || "None";
            return (
              <div key={f.key} className={styles.kv}>
                <label className={styles.kvLabel} htmlFor={`${ids}-${f.key}`}>
                  {f.label}
                </label>
                <span className={styles.kvValue}>
                  {isChanged && (
                    <span className={styles.struck}>
                      <span className="h-sr-only">was </span>
                      {show(old)}
                    </span>
                  )}
                  {f.kind === "date" ? (
                    <span className={styles.dateValue}>
                      <span aria-hidden="true">{show(now)}</span>
                      <input
                        id={`${ids}-${f.key}`}
                        type="date"
                        className={styles.dateInput}
                        value={now}
                        disabled={locked}
                        onChange={(e) => setEdits((x) => ({ ...x, [f.key]: e.target.value }))}
                      />
                    </span>
                  ) : (
                    <span className={styles.autosize} data-value={now || " "}>
                    <input
                      id={`${ids}-${f.key}`}
                      className={styles.kvInput}
                      size={1}
                      value={now}
                      disabled={locked}
                      maxLength={f.key === "batch" ? 30 : 120}
                      onChange={(e) => setEdits((x) => ({ ...x, [f.key]: f.key === "batch" ? e.target.value.toUpperCase() : e.target.value }))}
                    />
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <label className={`${styles.field} ${styles.groupGap}`}>
          <span className={styles.fieldLabel}>Reason</span>
          <textarea className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} rows={3} disabled={locked} />
        </label>

        {!locked && (
          <button type="button" className={styles.withdraw} onClick={() => setConfirm(true)}>
            <span className={styles.withdrawTitle}>Or withdraw it</span>
            <span className={styles.withdrawText}>{withdrawSentence(kind, name, record.requestedBy)}</span>
          </button>
        )}
      </div>

      {!locked && (
        <div className={styles.footer}>
          {error && !confirm && (
            <p className={styles.footAlert} role="alert">
              {error}
            </p>
          )}
          <button type="button" className={styles.dark} onClick={() => void run("correct")} disabled={!ready || busy !== null} aria-busy={busy === "correct" || undefined}>
            Sign correction
          </button>
        </div>
      )}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Withdraw ${name}'s ${recordNoun(kind, record.title)} record?`}
        footer={
          <>
            {error && (
              <p className={styles.footAlert} role="alert">
                {error}
              </p>
            )}
            <button type="button" className={styles.dark} onClick={() => void run("withdraw")} disabled={busy !== null} aria-busy={busy === "withdraw" || undefined}>
              {signLabel("Withdraw")}
            </button>
          </>
        }
      >
        <p className={styles.sheetText}>
          {withdrawSentence(kind, name, record.requestedBy).replace(/^If this dog wasn't [a-z]+ by you\. /, "")} The withdrawal is signed like the record, and both stay in the ledger.
        </p>
      </Sheet>
    </div>
  );
}
