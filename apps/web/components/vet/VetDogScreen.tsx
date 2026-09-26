"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { avatarPalette, TabBar } from "@/components/ds";
import { chromeFor } from "@/components/ChromeShell";
import { ApiError } from "@/lib/api";
import { pronouns } from "@/lib/care-copy";
import { dogName } from "@/lib/streak";
import { ago, maySign, noSignLine, shortDate } from "./vet-copy";
import { vetApi, type HealthRecord, type VetDogView } from "./vet-api";
import { useOnMount, useSignedIn, VetMessage } from "./VetParts";
import styles from "./vet.module.css";

/**
 * V2b "A dog's page, for a vet" (design v7): the feeder's dog page with a
 * block only a vet sees ("VET · ONLY YOU SEE THIS": Sign vaccination, Mark
 * sterilised, Add treatment, Health notes), the feeder notes waiting to be
 * confirmed, and the red-outlined "This dog needs help". A vet keeps every
 * feeder action: "I fed Rani" and Share.
 *
 * Opened by scanning a collar from the Vet tab, from search, or from the
 * collar page's "Open vet view". The board draws the tab bar here; the shell
 * treats /vet/dogs/** as a focused screen, so this screen draws the bar
 * itself when the shell does not.
 */

function feedLine(view: VetDogView, her: string): string {
  const last = view.lastFed ? `last fed by ${view.lastFed.byFirstName ?? "a feeder"} ${ago(view.lastFed.at)}` : "";
  if (view.youFeed) return [`You feed ${her} too`, last].filter(Boolean).join(" · ");
  if (last) return last.charAt(0).toUpperCase() + last.slice(1);
  return "No feeds logged yet";
}

/** "1 feeder note to confirm: deworming, 3 Aug". */
export function notesLine(notes: HealthRecord[]): string {
  const first = notes[0]!;
  const what = [first.title.toLowerCase(), shortDate(first.date)].filter(Boolean).join(", ");
  return notes.length === 1 ? `1 feeder note to confirm: ${what}` : `${notes.length} feeder notes to confirm: ${what} and more`;
}

export default function VetDogScreen({ slug }: { slug: string }): React.JSX.Element {
  const pathname = usePathname();
  const { toLogin, signedIn } = useSignedIn(`/vet/dogs/${slug}`);
  const [load, setLoad] = useState<
    { kind: "loading" } | { kind: "error"; notFound: boolean } | { kind: "ready"; view: VetDogView; status: string | null }
  >({
    kind: "loading",
  });
  const [shared, setShared] = useState<string | null>(null);

  const fetchDog = useCallback(async () => {
    try {
      const [view, vet] = await Promise.all([vetApi.getVetDog(slug), vetApi.getMyVet().catch(() => null)]);
      setLoad({ kind: "ready", view, status: vet?.status ?? null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && err.status === 403) {
        // Not a verified vet: the public page is the right place.
        window.location.assign(`/d/${encodeURIComponent(slug)}`);
        return;
      }
      setLoad({ kind: "error", notFound: err instanceof ApiError && err.status === 404 });
    }
  }, [slug, toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchDog();
  });

  const drawTabBar = !chromeFor(pathname).tabBar;

  if (load.kind !== "ready") {
    return (
      <VetMessage
        back="Vet"
        href="/vet"
        title={load.kind === "error" ? (load.notFound ? "No dog has this code." : "Hetja could not be reached.") : undefined}
        lead={load.kind === "loading" ? "Loading." : load.notFound ? undefined : "Check your connection and try again."}
        role={load.kind === "loading" ? "status" : undefined}
      >
        {load.kind === "error" && !load.notFound && (
          <button type="button" className={`${styles.textLink} ${styles.more}`} onClick={() => void fetchDog()}>
            Try again
          </button>
        )}
      </VetMessage>
    );
  }

  const { view, status } = load;
  const signable = maySign(status, view.canSign);
  const name = dogName(view.dog.name);
  const p = pronouns(view.dog.sex);
  const notes = view.notesToConfirm.length ? view.notesToConfirm : view.health.filter((r) => r.status === "feeder_noted" && !r.requestOpen);
  const pal = avatarPalette(slug);
  const sign = (kind: string) => `/vet/dogs/${encodeURIComponent(slug)}/sign?kind=${kind}`;
  const note = notes[0];
  const noteHref = note
    ? `/vet/dogs/${encodeURIComponent(slug)}/sign?note=${encodeURIComponent(note.id)}&kind=${
        note.kind === "sterilisation" || note.kind === "vaccination" ? note.kind : "treatment"
      }`
    : null;

  const share = async () => {
    const url = `${window.location.origin}/d/${slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name} on Hetja`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared("Link copied.");
    } catch {
      /* the share sheet was closed */
    }
  };

  return (
    <div className={styles.page} style={drawTabBar ? ({ "--tab-clear": "var(--h-tab-clear)" } as React.CSSProperties) : undefined}>
      <div className={styles.hero} style={{ background: `var(--h-av-${pal}-bg)` }}>
        {view.dog.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.dog.photoUrl} alt={`${name}'s photo`} className={styles.heroImg} />
        ) : (
          <span className={styles.heroInitial} style={{ color: `var(--h-av-${pal}-ink)` }} aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className={styles.dogBody}>
        <h1 className={styles.dogName}>{name}</h1>
        <p className={styles.dogSub}>{feedLine(view, p.object)}</p>
        <div className={styles.pair}>
          <Link href={`/feed?dog=${encodeURIComponent(slug)}`} className={styles.fedBtn}>
            I fed {name}
          </Link>
          <button type="button" className={styles.quiet} onClick={() => void share()}>
            Share
          </button>
        </div>
        {shared && (
          <p className={styles.status} role="status">
            {shared}
          </p>
        )}

        <section className={styles.vetBox} aria-labelledby="vet-only">
          <h2 className={styles.vetLabel} id="vet-only">
            Vet · only you see this
          </h2>
          <div className={styles.vetGrid}>
            {signable && (
              <>
                <Link href={sign("vaccination")} className={styles.vetBtn}>
                  Sign vaccination
                </Link>
                <Link href={sign("sterilisation")} className={styles.vetBtn}>
                  Mark sterilised
                </Link>
                <Link href={sign("treatment")} className={styles.vetBtn}>
                  Add treatment
                </Link>
              </>
            )}
            <Link href={`/vet/dogs/${encodeURIComponent(slug)}/health`} className={styles.vetBtn}>
              Health notes
            </Link>
          </div>
          {!signable && (
            <p className={styles.vetNote} role="status">
              {noSignLine(status)}
            </p>
          )}
          {signable && note && noteHref && (
            <Link href={noteHref} className={styles.vetNote}>
              {notesLine(notes)}
            </Link>
          )}
        </section>

        <a href={`/d/${encodeURIComponent(slug)}`} className={styles.helpBtn}>
          This dog needs help
        </a>
      </div>
      {drawTabBar && <TabBar active="vet" />}
    </div>
  );
}
