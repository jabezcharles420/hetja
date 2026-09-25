"use client";

/**
 * V14 "Kalu is almost on Hetja." (design v6, replacing v5 R6 on this route).
 * Route protection is a UX boundary, not a security boundary (see
 * RequireCapability); the API is the boundary.
 *
 * The signed collar URL comes from GET /registrations/:slug (behind auth), so
 * the signature never sits in a URL bar. Kept from R6 (v6 CONTRACT.md): the
 * real QR (lib/qr.ts, version 5 ECC M, byte for byte the collar URL), drawn
 * at 150 px with the card's white padding as its quiet zone, and the grey
 * Unverified pill. The lead now says what happens next ("scan it once to
 * switch his page on"), which is the activation line R6 carried. The
 * material advice lives on the print screen (P5).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, StickyFooter } from "@/components/ds";
import { api, ApiError, type RegistrationDetail } from "@/lib/api";
import { dogCopyV6, possessive, prettyCode, recallDogSex, type DogSex } from "@/lib/dog-copy";
import { buildCollarQrSvg } from "@/lib/qr";
import RequireCapability from "@/components/RequireCapability";
import s from "../../register.module.css";
import styles from "./ready.module.css";

export function readyTitle(name: string | null | undefined): string {
  return dogCopyV6.almostOn(name);
}

/** The line under the code, as on the printed tag. */
export function tagLine(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `${n} · Scan me if I look lost` : "Scan me if I look lost";
}

function ReadyInner({ slug }: { slug: string }): React.JSX.Element {
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sex, setSex] = useState<DogSex | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.getRegistration(slug));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this collar.");
    }
  }, [slug]);

  useEffect(() => {
    setSex(recallDogSex(slug));
    void load();
  }, [load, slug]);

  const qr = useMemo(
    () => (detail ? buildCollarQrSvg(detail.collarUrl, { sizeMm: 40, quietZone: false }) : null),
    [detail],
  );

  if (!detail || !qr) {
    return (
      <div className={s.page}>
        <div className={s.top}>
          <Link href="/register" className={s.topLink}>
            ‹ Registrations
          </Link>
        </div>
        <div className={s.body}>
          {error ? (
            <>
              <h1 className={s.titleXL}>Collar not found.</h1>
              <p className={s.lead} role="alert">
                {error}
              </p>
              <Link href="/register" className={s.topLink}>
                Back to Register ›
              </Link>
            </>
          ) : (
            <p className={s.lead} role="status">
              Loading…
            </p>
          )}
        </div>
      </div>
    );
  }

  const code = prettyCode(detail.slug);

  return (
    <div className={[s.page, s.aurora].join(" ")}>
      <div className={[s.body, styles.body].join(" ")}>
        <h1 className={s.hero}>{dogCopyV6.almostOn(detail.name)}</h1>
        <p className={s.heroLead}>{dogCopyV6.almostLead(sex)}</p>

        <div className={styles.tag}>
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <div className={styles.code} aria-label={`Collar code ${code}`}>
            {code.split(" ").map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
          <div className={styles.tagLine}>{tagLine(detail.name)}</div>
          <div className={styles.pill}>Unverified · needs one confirmation</div>
        </div>
      </div>

      <StickyFooter background="none" className={s.footerTight}>
        <Button href={`/register/${slug}/print`} fullWidth>
          Print {possessive(detail.name)} tag
        </Button>
        <Link href="/register" className={s.linkBtn}>
          I&apos;ll print it later
        </Link>
      </StickyFooter>
    </div>
  );
}

export default function ReadyClient({ slug }: { slug: string }): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <ReadyInner slug={slug} />
    </RequireCapability>
  );
}
