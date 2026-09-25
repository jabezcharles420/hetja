"use client";

/**
 * R8 Batch sheet (design v5): up to eight of the caller's dogs on one A4
 * page, two tags each (the A4 mock's page 03). Route protection is a UX
 * boundary, not a security boundary (see RequireCapability); the API is the
 * boundary, and POST /collars/batch only signs dogs the caller registered
 * or fed in the last 60 days (anything else comes back in `skipped`).
 *
 * The dogs are GET /feeders/me/dogs. The note on each row comes from the
 * dog's state: "New" (not yet switched on), "Reprint" (an open tag problem),
 * "Printed" (this phone already printed its tags). Everything not yet printed
 * starts ticked, and a dog handed over from R7 (?add=<slug>) always is.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, StickyFooter } from "@/components/ds";
import { api, ApiError, type MyDogV5 } from "@/lib/api";
import { BATCH_MAX_DOGS, readPrinted } from "@/lib/collar-sheet";
import {
  downloadSheet,
  loadCollar,
  loadWards,
  makeSheetPdf,
  printerName,
  recordPrints,
  resolveReprinted,
  toSheetDog,
} from "@/lib/collar-print";
import { prettyCode } from "@/lib/dog-copy";
import RequireCapability from "@/components/RequireCapability";
import s from "../register.module.css";
import styles from "./batch.module.css";

export type BatchNote = "New" | "Reprint" | "Printed" | "";

export function batchNote(d: Pick<MyDogV5, "slug" | "status" | "attention">, printed: Record<string, number>): BatchNote {
  if (d.attention?.kind === "tag") return "Reprint";
  if (d.status === "pending_activation" || d.attention?.kind === "new") return printed[d.slug] ? "Printed" : "New";
  if (printed[d.slug]) return "Printed";
  return "";
}

type Row = { slug: string; name: string | null; note: BatchNote };

/** Which rows start ticked: the handed-over dog, then everything not yet printed, up to 8. */
export function initialSelection(rows: Row[], add: string | null): string[] {
  const out: string[] = [];
  if (add && rows.some((r) => r.slug === add)) out.push(add);
  for (const r of rows) {
    if (out.length >= BATCH_MAX_DOGS) break;
    if (r.note !== "Printed" && !out.includes(r.slug)) out.push(r.slug);
  }
  return out;
}

function BatchInner(): React.JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [printedBy, setPrintedBy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const add = new URLSearchParams(window.location.search).get("add");
    let cancelled = false;
    (async () => {
      try {
        const [mine, me] = await Promise.all([api.getMyDogsV5(), api.getFeederMe().catch(() => null)]);
        const printed = readPrinted();
        const list: Row[] = mine.dogs
          .filter((d) => d.status !== "deceased")
          .map((d) => ({ slug: d.slug, name: d.name, note: batchNote(d, printed) }));
        if (add && !list.some((r) => r.slug === add)) {
          // A dog registered a moment ago may not be listed yet.
          try {
            const c = await loadCollar(add);
            list.unshift({ slug: c.slug, name: c.name, note: "New" });
          } catch {
            /* not ours to print: POST /collars/batch would skip it anyway */
          }
        }
        if (cancelled) return;
        setPrintedBy(printerName(me));
        setRows(list);
        setPicked(initialSelection(list, add));
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your dogs.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const full = picked.length >= BATCH_MAX_DOGS;
  const ordered = useMemo(() => (rows ?? []).filter((r) => picked.includes(r.slug)).map((r) => r.slug), [rows, picked]);

  const toggle = (slug: string) => {
    setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : p.length >= BATCH_MAX_DOGS ? p : [...p, slug]));
  };

  const selectAll = () => setPicked((rows ?? []).slice(0, BATCH_MAX_DOGS).map((r) => r.slug));

  const download = async () => {
    if (ordered.length === 0) return;
    setBusy(true);
    setStatus(null);
    setFailed(false);
    try {
      const [res, wards] = await Promise.all([api.getCollarBatch(ordered), loadWards()]);
      const dogs = res.dogs.map((d) => toSheetDog(d, wards));
      if (res.skipped.length > 0) {
        setStatus(
          `${res.skipped.length} ${res.skipped.length === 1 ? "dog was" : "dogs were"} left off: you can print dogs you registered or fed in the last 60 days.`,
        );
      }
      if (dogs.length === 0) return;
      const sheet = await makeSheetPdf("batch", "a4", dogs, printedBy);
      recordPrints("batch", "a4", dogs);
      downloadSheet(sheet);
      // A dog on the sheet for a broken tag: close what the reprint fixes.
      for (const d of dogs) {
        if (rows?.find((r) => r.slug === d.slug)?.note === "Reprint") void resolveReprinted(d.slug, null);
      }
      const printed = readPrinted();
      setRows((r) => r?.map((x) => (printed[x.slug] && x.note !== "Reprint" ? { ...x, note: "Printed" } : x)) ?? r);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.page}>
      <div className={s.top}>
        <Link href="/me" className={s.topLink}>
          ‹ Me
        </Link>
        <button type="button" className={s.topLink} onClick={selectAll} disabled={!rows || rows.length === 0}>
          Select all
        </button>
      </div>
      <div className={[s.body, styles.body].join(" ")}>
        <div className={styles.head}>
          <h1 className={s.title}>Batch sheet</h1>
          <p className={s.text}>
            {picked.length} of {BATCH_MAX_DOGS} slots on this A4 page
          </p>
        </div>
        <div
          className={styles.slots}
          role="progressbar"
          aria-label="Slots used"
          aria-valuemin={0}
          aria-valuemax={BATCH_MAX_DOGS}
          aria-valuenow={picked.length}
        >
          {Array.from({ length: BATCH_MAX_DOGS }, (_, i) => (
            <span key={i} className={[styles.slot, i < picked.length ? styles.slotOn : ""].filter(Boolean).join(" ")} />
          ))}
        </div>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {!rows && !error && (
          <p className={s.status} role="status">
            Loading…
          </p>
        )}
        {rows && rows.length === 0 && (
          <p className={s.status}>
            Dogs you register or feed show here. <Link href="/register">Register a dog ›</Link>
          </p>
        )}
        {rows && rows.length > 0 && (
          <ul className={styles.list}>
            {rows.map((r) => {
              const on = picked.includes(r.slug);
              const name = r.name?.trim() || "No name";
              return (
                <li key={r.slug}>
                  <label className={styles.row} data-disabled={!on && full ? "true" : undefined}>
                    <input
                      type="checkbox"
                      className={s.visuallyHidden}
                      checked={on}
                      disabled={!on && full}
                      onChange={() => toggle(r.slug)}
                    />
                    <span className={[s.tick, on ? s.tickOn : ""].filter(Boolean).join(" ")} aria-hidden="true">
                      {on ? "✓" : ""}
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.name}>{name}</span>
                      <span className={styles.code}>{prettyCode(r.slug)}</span>
                    </span>
                    {r.note && <span className={styles.note}>{r.note}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {status && (
          <p className={s.status} role="status">
            {status}
          </p>
        )}
        {failed && (
          <p className={s.error} role="alert">
            Could not make the PDF on this phone.{" "}
            <Link href={`/register/batch/sheet?slugs=${ordered.join(",")}&paper=a4`} className={styles.inlineLink}>
              Open the printable page instead ›
            </Link>
          </p>
        )}
      </div>
      <StickyFooter background="mist">
        <Button
          fullWidth
          disabled={busy || ordered.length === 0}
          aria-busy={busy || undefined}
          onClick={() => void download()}
        >
          Download sheet · {ordered.length} tags
        </Button>
      </StickyFooter>
    </div>
  );
}

export default function BatchClient(): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <BatchInner />
    </RequireCapability>
  );
}
