"use client";

/**
 * The print-friendly HTML fallback for the collar sheets: the same pages as
 * the PDF (components/CollarSheet.tsx), at real millimetres, with an @page
 * rule so the browser's own Print (and "Save as PDF") lays out one sheet per
 * page at 100%. Offered by R7 and R8 when the in-browser PDF cannot be made.
 *
 * Query: ?layout=tags|notice&paper=a4|letter for one dog (the route's slug),
 * or ?slugs=a,b,c&paper=a4 on /register/batch/sheet. Read from
 * window.location after mount, so the page needs no Suspense boundary.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import CollarSheet from "@/components/CollarSheet";
import { BATCH_MAX_DOGS, PAPER_MM, sheetText, type Paper, type SheetDog, type SheetLayout } from "@/lib/collar-sheet";
import {
  loadCollar,
  loadSexes,
  loadWards,
  printerName,
  recordPrints,
  resolveReprinted,
  toSheetDog,
} from "@/lib/collar-print";
import RequireCapability from "@/components/RequireCapability";
import styles from "./sheet.module.css";

function readQuery(): { layout: SheetLayout; paper: Paper; slugs: string[] } {
  const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const l = q.get("layout");
  const layout: SheetLayout = l === "notice" ? "notice" : l === "batch" ? "batch" : "tags";
  const paper: Paper = q.get("paper") === "letter" ? "letter" : "a4";
  const slugs = (q.get("slugs") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, BATCH_MAX_DOGS);
  return { layout, paper, slugs };
}

function SheetInner({ slug, backHref }: { slug?: string; backHref: string }): React.JSX.Element {
  const [dogs, setDogs] = useState<SheetDog[] | null>(null);
  const [layout, setLayout] = useState<SheetLayout>(slug ? "tags" : "batch");
  const [paper, setPaper] = useState<Paper>("a4");
  const [printedBy, setPrintedBy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = readQuery();
    const lay: SheetLayout = slug ? (q.layout === "batch" ? "tags" : q.layout) : "batch";
    setLayout(lay);
    setPaper(q.paper);
    let cancelled = false;
    (async () => {
      try {
        const [wards, me] = await Promise.all([loadWards(), api.getFeederMe().catch(() => null)]);
        let list: SheetDog[];
        if (slug) {
          const [collar, sexes] = await Promise.all([loadCollar(slug), loadSexes([slug])]);
          list = [toSheetDog(collar, wards, sexes[slug])];
        } else {
          if (q.slugs.length === 0) throw new Error("Pick the dogs on the batch screen first.");
          const res = await api.getCollarBatch(q.slugs);
          const sexes = await loadSexes(res.dogs.map((d) => d.slug));
          list = res.dogs.map((d) => toSheetDog(d, wards, sexes[d.slug]));
        }
        if (cancelled) return;
        setPrintedBy(printerName(me));
        setDogs(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError || err instanceof Error ? err.message : "Could not load the sheet.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const { w, h } = PAPER_MM[paper];
  const print = () => {
    if (dogs) {
      recordPrints(layout, paper, dogs);
      // One dog's tags reprinted: close what a reprint fixes (F6 ?report=).
      if (slug && layout === "tags") {
        void resolveReprinted(slug, new URLSearchParams(window.location.search).get("report"));
      }
    }
    window.print();
  };

  return (
    <div className={styles.page}>
      {/* One sheet per printed page, no browser margins: the sheet has its own. */}
      <style>{`@page { size: ${w}mm ${h}mm; margin: 0; }`}</style>
      <div className={styles.toolbar}>
        <Link href={backHref} className={styles.back}>
          ‹ Back
        </Link>
        <button type="button" className={styles.printBtn} onClick={print} disabled={!dogs}>
          Print
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!dogs && !error && (
        <p className={styles.status} role="status">
          Loading…
        </p>
      )}
      {dogs && (
        <div className={styles.sheetWrap} role="region" aria-label="Printable collar sheet">
          <CollarSheet layout={layout} paper={paper} dogs={dogs} text={sheetText(printedBy)} className={styles.sheet} />
        </div>
      )}
    </div>
  );
}

export default function PrintableSheet({ slug, backHref }: { slug?: string; backHref: string }): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <SheetInner slug={slug} backHref={backHref} />
    </RequireCapability>
  );
}
