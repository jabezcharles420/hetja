/**
 * The collar sheets as HTML (design v5, "Hetja Collar Sheet A4"), at real
 * millimetres. Two jobs:
 *
 *   1. The print-friendly fallback at /register/[slug]/print/sheet and
 *      /register/batch/sheet, printed with window.print() and an @page rule.
 *   2. The live mini preview on R7, scaled down with a CSS transform.
 *
 * The downloadable PDF (lib/collar-pdf.ts) draws the same pages from the same
 * copy and sizes (lib/collar-sheet.ts). QR sizes and the quiet zone: lib/qr.ts.
 */

import { useMemo } from "react";
import {
  PAPER_MM,
  SHEET_COPY,
  TAGS_PER_DOG_IN_BATCH,
  TAGS_PER_SHEET,
  bandCode,
  bandLine,
  batchHeader,
  batchHeaderRight,
  dogName,
  noticeFed,
  noticeLead,
  noticeTitle,
  noticeWard,
  tagsHeader,
  tagsHeaderRight,
  type Paper,
  type SheetDog,
  type SheetLayout,
  type SheetText,
} from "@/lib/collar-sheet";
import { prettyCode } from "@/lib/dog-copy";
import { BAND_QR_MM, NOTICE_QR_MM, TAG_QR_MM, buildCollarQrSvg } from "@/lib/qr";
import styles from "./CollarSheet.module.css";

function Qr({ url, sizeMm, quiet }: { url: string; sizeMm: number; quiet: boolean }): React.JSX.Element {
  const svg = useMemo(() => buildCollarQrSvg(url, { sizeMm, quietZone: quiet }).svg, [url, sizeMm, quiet]);
  return (
    <span
      className={styles.qr}
      style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function Tag({ dog }: { dog: SheetDog }): React.JSX.Element {
  const n = dogName(dog);
  return (
    <div className={styles.tag}>
      <span className={styles.punch} aria-hidden="true" />
      <div className={styles.tagBrand}>{SHEET_COPY.tagBrand}</div>
      <Qr url={dog.collarUrl} sizeMm={TAG_QR_MM} quiet />
      <div className={styles.tagName}>{n ?? " "}</div>
      <div className={styles.tagCode}>{prettyCode(dog.slug)}</div>
    </div>
  );
}

function Header({ left, right }: { left: string; right: string }): React.JSX.Element {
  return (
    <div className={styles.header}>
      <div className={styles.headLeft}>
        <span className={styles.brand}>{SHEET_COPY.brand}</span>
        <span className={styles.sub}>{left}</span>
      </div>
      <div className={styles.meta}>{right}</div>
    </div>
  );
}

function TagsPage({ dog, text }: { dog: SheetDog; text: SheetText }): React.JSX.Element {
  return (
    <div className={styles.pad12} style={{ gap: "6mm" }}>
      <Header left={tagsHeader(dog)} right={tagsHeaderRight(text)} />
      <div className={styles.block}>
        <div className={styles.h11}>{SHEET_COPY.tagsTitle}</div>
        <div className={styles.tagGrid}>
          {Array.from({ length: TAGS_PER_SHEET }, (_, i) => (
            <Tag key={i} dog={dog} />
          ))}
        </div>
      </div>
      <div className={styles.block}>
        <div className={styles.h11}>{SHEET_COPY.bandTitle}</div>
        <div className={styles.bands}>
          {[0, 1].map((i) => (
            <div key={i} className={styles.band}>
              <Qr url={dog.collarUrl} sizeMm={BAND_QR_MM} quiet={false} />
              <div className={styles.bandText}>
                <div className={styles.bandLine}>{bandLine(dog)}</div>
                <div className={styles.bandCode}>{bandCode(dog)}</div>
              </div>
              <span className={styles.fold} aria-hidden="true" />
              <span className={styles.foldNote}>{SHEET_COPY.bandFold}</span>
              <Qr url={dog.collarUrl} sizeMm={BAND_QR_MM} quiet={false} />
            </div>
          ))}
        </div>
      </div>
      <div className={styles.steps}>
        {SHEET_COPY.steps.map((s) => (
          <div key={s.title} className={styles.step}>
            <div className={styles.h11}>{s.title}</div>
            <div className={styles.stepBody}>{s.body}</div>
          </div>
        ))}
      </div>
      <div className={styles.foot}>{SHEET_COPY.tagsFoot}</div>
    </div>
  );
}

function NoticePage({ dog }: { dog: SheetDog }): React.JSX.Element {
  const fed = noticeFed(dog);
  return (
    <div className={styles.notice}>
      <div className={styles.noticeTop}>
        <span className={styles.kicker}>{SHEET_COPY.noticeKicker}</span>
        <span className={styles.ward}>{noticeWard(dog)}</span>
      </div>
      <div className={styles.noticeTitle}>{noticeTitle(dog)}</div>
      <div className={styles.noticeLead}>{noticeLead(dog)}</div>
      <div className={styles.noticeFrame}>
        <Qr url={dog.collarUrl} sizeMm={NOTICE_QR_MM} quiet />
      </div>
      <div className={styles.noticeCode}>{prettyCode(dog.slug)}</div>
      <div className={styles.cards}>
        <div className={styles.noticeCard}>
          <div className={styles.cardTitle}>{SHEET_COPY.noticeSos}</div>
          <div className={styles.cardBody}>{SHEET_COPY.noticeSosBody}</div>
        </div>
        <div className={styles.noticeCard}>
          <div className={styles.cardTitle}>{fed.title}</div>
          <div className={styles.cardBody}>{fed.body}</div>
        </div>
      </div>
      <div className={styles.noticeFoot}>{SHEET_COPY.noticeFoot}</div>
    </div>
  );
}

function BatchPage({ dogs, text }: { dogs: SheetDog[]; text: SheetText }): React.JSX.Element {
  return (
    <div className={styles.pad12} style={{ gap: "5mm" }}>
      <Header left={batchHeader(dogs)} right={batchHeaderRight(text)} />
      <div className={styles.batchGrid}>
        {dogs.map((d) => (
          <div key={d.slug} className={styles.pair}>
            {Array.from({ length: TAGS_PER_DOG_IN_BATCH }, (_, i) => (
              <Tag key={i} dog={d} />
            ))}
          </div>
        ))}
      </div>
      <div className={styles.batchFoot}>{SHEET_COPY.batchFoot}</div>
    </div>
  );
}

export interface CollarSheetProps {
  layout: SheetLayout;
  paper: Paper;
  dogs: SheetDog[];
  text: SheetText;
  className?: string;
}

/** One sheet page at its real size. */
export default function CollarSheet({ layout, paper, dogs, text, className }: CollarSheetProps): React.JSX.Element | null {
  const first = dogs[0];
  if (!first) return null;
  const { w, h } = PAPER_MM[paper];
  return (
    <section
      className={[styles.page, className ?? ""].filter(Boolean).join(" ")}
      style={{ width: `${w}mm`, height: `${h}mm` }}
      data-layout={layout}
      data-paper={paper}
    >
      {layout === "tags" && <TagsPage dog={first} text={text} />}
      {layout === "notice" && <NoticePage dog={first} />}
      {layout === "batch" && <BatchPage dogs={dogs} text={text} />}
    </section>
  );
}
