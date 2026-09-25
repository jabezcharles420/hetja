"use client";

/**
 * R6 Code ready (design v5, "Rani is on Hetja."). Route protection is a UX
 * boundary, not a security boundary (see RequireCapability); the API is the
 * boundary.
 *
 * The signed collar URL comes from GET /registrations/:slug (behind auth), so
 * the signature never sits in a URL bar. The QR is the real one (lib/qr.ts,
 * version 5 ECC M, byte for byte the collar URL), drawn at 180 px with the
 * card's white padding as its quiet zone.
 *
 * Adapted from the mock (CONTRACT.md): a pending registration also shows the
 * existing activation line, because the first scan on the collar is what
 * switches the profile on (an abuse control, INVARIANTS: registrations).
 *
 * "Ask a vet to confirm" hands the phone's share sheet a short message for a
 * vet and a link to the dog's page (/d/<slug>, no signature: the code's check
 * character is enough for a typed or linked visit). Without a share sheet it
 * copies the same text and says so.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, StickyFooter } from "@/components/ds";
import { api, ApiError, type RegistrationDetail } from "@/lib/api";
import { dogCopy, prettyCode, recallDogSex, type DogSex } from "@/lib/dog-copy";
import { buildCollarQrSvg } from "@/lib/qr";
import RequireCapability from "@/components/RequireCapability";
import s from "../../register.module.css";
import styles from "./ready.module.css";

export function readyTitle(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `${n} is on Hetja.` : "Your dog is on Hetja.";
}

/** The dog's public page, from the collar URL's own origin. */
export function dogPageUrl(collarUrl: string, slug: string): string {
  try {
    return `${new URL(collarUrl).origin}/d/${slug}`;
  } catch {
    return `https://hetja.in/d/${slug}`;
  }
}

function ReadyInner({ slug }: { slug: string }): React.JSX.Element {
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sex, setSex] = useState<DogSex | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

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
        <div className={[s.top, s.topEnd].join(" ")}>
          <Link href="/me" className={s.topLink}>
            Done
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

  const askVet = async () => {
    setShareNote(null);
    const url = dogPageUrl(detail.collarUrl, detail.slug);
    const text = dogCopy.vetMessage(detail.name, code, sex);
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (nav && typeof nav.share === "function") {
      try {
        await nav.share({ title: readyTitle(detail.name), text, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        /* fall through to copy */
      }
    }
    try {
      await nav?.clipboard?.writeText(`${text} ${url}`);
      setShareNote("Message and link copied. Paste them to a vet: once they check the dog, the Unverified badge goes.");
    } catch {
      setShareNote(`Send a vet this link: ${url}`);
    }
  };

  return (
    <div className={[s.page, styles.page].join(" ")}>
      <div className={[s.top, s.topEnd].join(" ")}>
        <Link href="/me" className={s.topLink}>
          Done
        </Link>
      </div>
      <div className={[s.body, styles.body].join(" ")}>
        <h1 className={s.titleXL}>{readyTitle(detail.name)}</h1>
        <p className={s.lead}>{dogCopy.readyLead(sex)}</p>

        <div className={styles.tag}>
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <div className={styles.code} aria-label={`Collar code ${detail.slug.split("").join(" ")}`}>
            {code.split(" ").map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
          <div className={styles.pill}>Unverified · needs one confirmation</div>
        </div>

        {detail.status === "pending_activation" && (
          <Link href={`/register/${slug}`} className={styles.activate}>
            Collar on the dog? Switch the profile on ›
          </Link>
        )}
        {shareNote && (
          <p className={styles.shareNote} role="status">
            {shareNote}
          </p>
        )}
      </div>

      <StickyFooter background="none" className={styles.footer}>
        <Button href={`/register/${slug}/print`} fullWidth>
          {dogCopy.printTag(sex)}
        </Button>
        <button type="button" className={s.linkBtn} onClick={() => void askVet()}>
          Ask a vet to confirm
        </button>
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
