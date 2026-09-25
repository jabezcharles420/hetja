"use client";

/**
 * R7 Print tag (design v5). Route protection is a UX boundary, not a
 * security boundary (see RequireCapability); the API is the boundary.
 *
 * Three layouts ("10 small tags + collar band", "1 large tag + wall notice",
 * "Add to a batch sheet", which hands over to R8 with this dog ticked),
 * A4 or Letter, a live preview of the real sheet, and a real vector PDF built
 * on this phone (lib/collar-pdf.ts, pdf-lib loaded only when a sheet is
 * built). "Send to a print shop" shares that PDF (Web Share API with files),
 * falling back to a download. Every sheet made is recorded with
 * POST /dogs/:slug/prints, best effort, and closes the tag problems a
 * reprint fixes (F6 "Reprint tag" links here with ?report=<id>; see
 * resolveReprinted in lib/collar-print.ts).
 *
 * If the PDF cannot be built, the print-friendly HTML page
 * (./sheet, @page A4 or Letter) is offered for the browser's own Print.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, StickyFooter } from "@/components/ds";
import { api, ApiError } from "@/lib/api";
import CollarSheet from "@/components/CollarSheet";
import { PAPER_MM, sheetText, type Paper, type SheetDog, type SheetLayout } from "@/lib/collar-sheet";
import {
  downloadSheet,
  loadCollar,
  loadWards,
  makeSheetPdf,
  printerName,
  recordPrints,
  resolveReprinted,
  shareSheet,
  toSheetDog,
} from "@/lib/collar-print";
import RequireCapability from "@/components/RequireCapability";
import s from "../../register.module.css";
import styles from "./print.module.css";

export const LAYOUT_OPTIONS = [
  { value: "tags", title: "10 small tags + collar band", sub: "Coin-sized, 32 × 46 mm" },
  { value: "notice", title: "1 large tag + wall notice", sub: "For a shop or society gate" },
  { value: "batch", title: "Add to a batch sheet", sub: "8 different dogs on one page" },
] as const;

/** Preview width on screen, as in the mock. */
const PREVIEW_W = 124;
const MM_PX = 96 / 25.4;

export function SheetPreview({
  layout,
  paper,
  dogs,
  printedBy,
}: {
  layout: SheetLayout;
  paper: Paper;
  dogs: SheetDog[];
  printedBy: string | null;
}): React.JSX.Element {
  const { w, h } = PAPER_MM[paper];
  const scale = PREVIEW_W / (w * MM_PX);
  return (
    <div className={styles.previewWrap}>
      <div
        className={styles.preview}
        style={{ width: PREVIEW_W, height: Math.round(PREVIEW_W * (h / w)) }}
        role="img"
        aria-label={`Preview of the ${paper === "a4" ? "A4" : "Letter"} sheet`}
      >
        <div className={styles.previewInner} style={{ transform: `scale(${scale})` }} aria-hidden="true">
          <CollarSheet layout={layout} paper={paper} dogs={dogs} text={sheetText(printedBy)} />
        </div>
      </div>
    </div>
  );
}

function PrintInner({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter();
  const [dog, setDog] = useState<SheetDog | null>(null);
  const [printedBy, setPrintedBy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<Exclude<SheetLayout, "batch">>("tags");
  const [paper, setPaper] = useState<Paper>("a4");
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** F6 "Reprint tag" hands over the open report it came from. */
  const reportId = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [collar, wards, me] = await Promise.all([
        loadCollar(slug),
        loadWards(),
        api.getFeederMe().catch(() => null),
      ]);
      setDog(toSheetDog(collar, wards));
      setPrintedBy(printerName(me));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this collar.");
    }
  }, [slug]);

  useEffect(() => {
    reportId.current = new URLSearchParams(window.location.search).get("report");
    void load();
  }, [load]);

  const name = dog?.name?.trim() || null;

  const make = async (how: "download" | "share") => {
    if (!dog) return;
    setBusy(how);
    setStatus(null);
    setFailed(false);
    try {
      const sheet = await makeSheetPdf(layout, paper, [dog], printedBy);
      recordPrints(layout, paper, [dog]);
      let handed = true;
      if (how === "download") downloadSheet(sheet);
      else {
        const r = await shareSheet(sheet, name ? `Hetja tags for ${name}` : "Hetja tags");
        handed = r !== "cancelled";
        if (r === "downloaded") {
          setStatus("This phone can't share files from here, so the PDF was downloaded instead.");
        }
      }
      if (handed) void resolveReprinted(dog.slug, reportId.current);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const sheetHref =
    `/register/${slug}/print/sheet?layout=${layout}&paper=${paper}` +
    (reportId.current ? `&report=${encodeURIComponent(reportId.current)}` : "");

  return (
    <div className={s.page}>
      <div className={s.top}>
        <Link href={`/register/${slug}/ready`} className={s.topLink}>
          ‹ {name ?? "Back"}
        </Link>
      </div>
      <div className={[s.body, styles.body].join(" ")}>
        <h1 className={s.title}>Print tag</h1>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {!dog && !error && (
          <p className={s.status} role="status">
            Loading…
          </p>
        )}
        {dog && <SheetPreview layout={layout} paper={paper} dogs={[dog]} printedBy={printedBy} />}

        <div className={s.card} role="radiogroup" aria-label="Layout">
          {LAYOUT_OPTIONS.map((o) => {
            const on = o.value === layout;
            return (
              <label key={o.value} className={[s.row, styles.option].join(" ")}>
                <input
                  type="radio"
                  name="layout"
                  value={o.value}
                  className={s.visuallyHidden}
                  checked={on}
                  onChange={() => {
                    if (o.value === "batch") router.push(`/register/batch?add=${encodeURIComponent(slug)}`);
                    else setLayout(o.value);
                  }}
                />
                <span
                  className={[styles.radio, on ? styles.radioOn : ""].filter(Boolean).join(" ")}
                  aria-hidden="true"
                />
                <span className={styles.optionText}>
                  <span className={styles.optionTitle}>{o.title}</span>
                  <span className={s.rowSub}>{o.sub}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className={styles.paperRow} role="radiogroup" aria-labelledby="paper-label">
          <span className={styles.paperLabel} id="paper-label">
            Paper
          </span>
          <div className={[s.segment, styles.paperSeg].join(" ")}>
            {(["a4", "letter"] as const).map((p) => (
              <label key={p} className={s.segOpt}>
                <input type="radio" name="paper" value={p} checked={paper === p} onChange={() => setPaper(p)} />
                <span>{p === "a4" ? "A4" : "Letter"}</span>
              </label>
            ))}
          </div>
        </div>

        {status && (
          <p className={s.status} role="status">
            {status}
          </p>
        )}
        {failed && (
          <p className={s.error} role="alert">
            Could not make the PDF on this phone.{" "}
            <Link href={sheetHref} className={styles.inlineLink}>
              Open the printable page instead ›
            </Link>
          </p>
        )}
      </div>

      <StickyFooter background="mist">
        <Button
          fullWidth
          disabled={!dog || busy !== null}
          aria-busy={busy === "download" || undefined}
          onClick={() => void make("download")}
        >
          Download PDF
        </Button>
        <button
          type="button"
          className={styles.shop}
          disabled={!dog || busy !== null}
          aria-busy={busy === "share" || undefined}
          onClick={() => void make("share")}
        >
          Send to a print shop
        </button>
      </StickyFooter>
    </div>
  );
}

export default function PrintClient({ slug }: { slug: string }): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <PrintInner slug={slug} />
    </RequireCapability>
  );
}
