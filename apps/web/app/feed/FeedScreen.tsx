"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DogAvatar, StatusIcon, StickyFooter, collarGroups } from "@/components/ds";
import {
  api,
  ApiError,
  bestEffortDeviceToken,
  getAccessToken,
  type DogProfile,
  type DogProfileV5,
  type FeedOutcomeValue,
} from "@/lib/api";
import { pronouns, sexOf } from "@/lib/care-copy";
import { FeedDone } from "./FeedDone";
import { FeedRound } from "./FeedRound";
import { parseCollarCode } from "@/lib/collar";
import {
  blobToBase64,
  captureGeo,
  enqueueFeed,
  flushOnOpen,
  listWaiting,
  stripDataPrefix,
  type WaitingFeed,
} from "@/lib/offline-queue";
import {
  cachedDogName,
  loadCareNumbers,
  refreshCareNumbers,
  rememberDogNames,
  telHref,
  type CareNumber,
} from "@/lib/care-cache";
import { prepareFeedPhoto } from "@/lib/photo";
import { dogName, kolkataDay, safeStreak, streakAfterFeed, streakCaption } from "@/lib/streak";
import styles from "./feed.module.css";

/**
 * Screen 06, Log a feed (design v4). Reached from Me's "Scan to log X's
 * feed" via /scan?intent=feed, which lands here as /feed?dog=<slug>.
 *
 * The photo is optional now; "How did it go?" is optional too. "Looks unwell"
 * shows a quiet pointer to the dog's SOS and never raises one by itself
 * (INVARIANT 14: the API stores 'unwell' as a flag for a human).
 *
 * The feed goes through the offline queue (enqueueFeed), so it survives no
 * signal: the record is persisted first and flushed when there is a network.
 *
 * Design v5 N7 "No signal": a feed saved with no signal gets its own screen
 * (the dark "Offline · N feeds waiting" banner, what is waiting, and the
 * care numbers for the feeder's wards, which lib/care-cache.ts keeps on this
 * phone while online). With no signal the dog profile cannot load, so the
 * screen falls back to the collar code and the dog's remembered name, and
 * the feed can still be logged.
 */

/** N7 copy (Hetja Audit and New Pages, N7), verbatim. */
export const OFFLINE_BODY =
  "It goes to Hetja when you're back online. Other feeders won't see it until then, so tell anyone nearby.";
export const SOS_NEEDS_SIGNAL =
  "SOS needs signal. With no signal, call a vet directly: numbers for your wards are saved on this phone.";
/** The same note when nothing is saved yet: it must not claim numbers it does not have. */
export const SOS_NEEDS_SIGNAL_NONE = "SOS needs signal. With no signal, call a vet directly.";

/** "Offline · 2 feeds waiting". */
export function offlineBanner(count: number): string {
  return `Offline · ${count} ${count === 1 ? "feed" : "feeds"} waiting`;
}

const OUTCOME_WORDS: Record<FeedOutcomeValue, string> = {
  ate_all: "ate it all",
  ate_some: "ate a little",
  didnt_eat: "didn't eat",
  unwell: "looks unwell",
};

/** One waiting row: "Kalu · ate a little", or the code when no name is known. */
export function waitingLine(w: Pick<WaitingFeed, "dogName" | "dogSlug" | "outcome">): string {
  const who = w.dogName?.trim() || collarGroups(w.dogSlug).join(" ");
  return w.outcome ? `${who} · ${OUTCOME_WORDS[w.outcome]}` : who;
}

function browserOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

export const OUTCOMES: { value: FeedOutcomeValue; label: string }[] = [
  { value: "ate_all", label: "Ate it all" },
  { value: "ate_some", label: "Ate a little" },
  { value: "didnt_eat", label: "Didn't eat" },
  { value: "unwell", label: "Looks unwell" },
];

/** The success toast. The dog's sex is not on the public profile, so the
 * mock's "in his own way" becomes the neutral "in their own way". */
export function loggedToast(name: string): string {
  return `Logged. ${name} is thrilled, in their own way.`;
}

export const QUEUED_TOAST = "Saved on this phone. It sends when you're back online.";

/** 429 RATE_LIMITED / 503 PHOTO_BUSY: the queue keeps it and retries after retry-after. */
export const BUSY_TOAST = "Saved on this phone. It sends when the server is less busy.";

/** photoAccepted:false: the feed counted, the photo did not stay. Quiet, not an error. */
export const PHOTO_NOT_KEPT = "Feed logged. The photo wasn't kept this time.";

/** geoAccepted:false: a location outside Mumbai was dropped. Nothing to worry about. */
export const GEO_IGNORED = "Location outside Mumbai was ignored.";

/** The quiet line under the toast, or null. */
export function feedNote(result: { photoAccepted?: boolean; geoAccepted?: boolean } | undefined): string | null {
  if (!result) return null;
  const lines: string[] = [];
  if (result.photoAccepted === false) lines.push(PHOTO_NOT_KEPT);
  if (result.geoAccepted === false) lines.push(GEO_IGNORED);
  return lines.length ? lines.join(" ") : null;
}

/** L2 note cap (POST /scans `note`). */
export const NOTE_MAX = 280;

/**
 * L2 "Tell Arjun": the dog's OTHER feeders, from the profile's `feeders`
 * (first names, null for anyone who opted out). One entry matching the
 * caller's own first name is taken out as the caller.
 */
export function coFeeders(
  feeders: { firstName: string | null }[] | undefined,
  myFirstName: string | null,
): { firstName: string | null }[] {
  const list = [...(feeders ?? [])];
  const i = myFirstName ? list.findIndex((f) => f.firstName === myFirstName) : -1;
  if (i >= 0) list.splice(i, 1);
  return list;
}

/** "Arjun", "Arjun and Meera", or null when the others are not all named (then "them"). */
export function coFeederNames(co: { firstName: string | null }[]): string | null {
  const named = co.map((c) => c.firstName).filter((n): n is string => !!n);
  if (named.length !== co.length || co.length === 0 || co.length > 2) return null;
  return named.join(" and ");
}

/** "Log feed", "Log feed and tell Arjun", "Log feed and tell them". */
export function logLabel(tell: boolean, names: string | null): string {
  if (!tell) return "Log feed";
  return `Log feed and tell ${names ?? "them"}`;
}

/** localStorage: feeds this phone has logged, for V23 after the FIRST one. */
export const FEEDS_LOGGED_KEY = "hetja.feedsLogged";

/** Count logged feeds on this phone; true when these are the FIRST (V23). Never throws. */
export function countFeeds(n = 1): boolean {
  try {
    const before = Number(localStorage.getItem(FEEDS_LOGGED_KEY)) || 0;
    localStorage.setItem(FEEDS_LOGGED_KEY, String(before + n));
    return before === 0;
  } catch {
    return false;
  }
}

type Load =
  | { kind: "loading" }
  | { kind: "no-dog" }
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | { kind: "ready"; dog: DogProfile; offline?: boolean };

function PhotoIcon(): React.JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function FeedScreen(): React.JSX.Element {
  const router = useRouter();
  // A ref so the load effect runs once, whatever the router's identity does.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [slug, setSlug] = useState<string>("");
  const [outcome, setOutcome] = useState<FeedOutcomeValue | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [streakDays, setStreakDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string } | null>(null);
  const [waiting, setWaiting] = useState<WaitingFeed[]>([]);
  const [careNumbers, setCareNumbers] = useState<CareNumber[]>([]);
  const [offlineNow, setOfflineNow] = useState(false);
  const [fed, setFed] = useState<{ streak: number | null; note: string | null; first: boolean } | null>(null);
  const [tellCo, setTellCo] = useState(true);
  const [unwellNote, setUnwellNote] = useState("");
  const [myFirstName, setMyFirstName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("dog") ?? "";
    const parsed = parseCollarCode(raw);

    // Signed out: sign in first, then come straight back here.
    if (!getAccessToken()) {
      const back = `/feed${raw ? `?dog=${encodeURIComponent(raw)}` : ""}`;
      routerRef.current.replace(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    if (!parsed.ok) {
      setLoad({ kind: "no-dog" });
      return;
    }
    setSlug(parsed.slug);

    let cancelled = false;
    // Online: keep this feeder's ward care numbers on the phone for N7.
    if (!browserOffline()) void refreshCareNumbers();
    // L2 needs to know which of the dog's feeders is the caller.
    api
      .getFeederMe()
      .then((me) => {
        if (!cancelled) setMyFirstName((me.publicName ?? me.displayName ?? "").trim().split(/\s+/)[0] || null);
      })
      .catch(() => undefined);
    (async () => {
      try {
        const dog = await api.getDog(parsed.slug);
        if (!cancelled) setLoad({ kind: "ready", dog });
        void rememberDogNames([dog]);
      } catch (err) {
        if (cancelled) return;
        const unreachable = err instanceof ApiError && (err.status === 0 || err.status === 408);
        if (unreachable && browserOffline()) {
          // No signal: the collar code is enough to log the feed.
          const name = await cachedDogName(parsed.slug);
          if (cancelled) return;
          setLoad({
            kind: "ready",
            offline: true,
            dog: {
              slug: parsed.slug,
              name,
              status: "active",
              wardId: "",
              photoKey: null,
              abcStatus: null,
              vaccineStatus: null,
              microStory: null,
              lastSeenAt: null,
              geo: null,
              photoUrl: null,
            },
          });
          return;
        }
        if (err instanceof ApiError && err.status === 404) setLoad({ kind: "not-found" });
        else
          setLoad({
            kind: "error",
            message: err instanceof ApiError ? err.message : "Could not load this dog.",
          });
      }
    })();
    (async () => {
      try {
        const s = safeStreak(await api.getStreak());
        if (!cancelled) setStreakDays(streakAfterFeed(s.streakDays, s.lastFeedDate, kolkataDay(new Date())));
      } catch {
        // No caption rather than a wrong one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // N7: keep the waiting list and banner honest while the screen is up, and
  // send the moment the signal comes back.
  useEffect(() => {
    if (!saved) return;
    let live = true;
    const refresh = async () => {
      const [w, c] = await Promise.all([listWaiting(), loadCareNumbers()]);
      if (!live) return;
      setWaiting(w);
      setCareNumbers(c?.numbers ?? []);
      setOfflineNow(browserOffline());
    };
    const onOnline = async () => {
      setOfflineNow(false);
      await flushOnOpen();
      await refresh();
    };
    const onOffline = () => setOfflineNow(true);
    void refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      live = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [saved]);

  const pickFile = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null);
  };

  const submit = useCallback(async () => {
    if (load.kind !== "ready" || busy || done) return;
    setBusy(true);
    setError(null);
    try {
      let photo: string | undefined;
      let photoGeo: { lat: number; lng: number } | undefined;
      if (file) {
        // Orient, compress, strip EXIF, and coarsen any photo GPS to ward
        // level before anything leaves the browser.
        const prepared = await prepareFeedPhoto(file);
        photo = stripDataPrefix(await blobToBase64(prepared.blob));
        photoGeo = prepared.geo;
      }
      // The consented device fix wins over photo EXIF: it becomes the dog's
      // last_seen_geo, which centres the SOS responder radius (see
      // lib/photo.ts). Ward-coarsened EXIF is only the fallback.
      const geo = (await captureGeo()) ?? photoGeo;
      // Minted at CAPTURE time and stored with the queued record, so a flush
      // days later presents a credential from when the feed happened.
      const deviceToken = await bestEffortDeviceToken();
      const unwell = outcome === "unwell";
      const telling = unwell && tellCo && coFeeders((load.dog as DogProfileV5).feeders, myFirstName).length > 0;
      const res = await enqueueFeed({
        dogSlug: load.dog.slug,
        photo,
        geo,
        deviceToken,
        ...(outcome ? { outcome } : {}),
        ...(load.dog.name ? { dogName: load.dog.name } : {}),
        ...(unwell && unwellNote.trim() ? { note: unwellNote.trim().slice(0, NOTE_MAX) } : {}),
        ...(telling ? { tellCoFeeders: true as const } : {}),
      });
      if (res.dropped) {
        // Refused for good (recordDroppedFeed has it). Say so; do not pretend.
        setError("Hetja couldn't log this feed. Try again.");
        return;
      }
      setDone(true);
      if (res.offline) {
        // N7: its own screen, and no auto-leave: the feeder reads it standing
        // next to the dog, with no signal.
        setOfflineNow(true);
        setSaved({ name: dogName(load.dog.name) });
        return;
      }
      const quiet = feedNote(res.result);
      if (res.result) {
        // Delivered while the feeder watched: V10. The first feed on this
        // phone is where V23 (add to home screen) belongs.
        setFed({ streak: res.result.streak?.streakDays ?? streakDays, note: quiet, first: countFeeds() });
        return;
      }
      setToast(
        res.offline
          ? QUEUED_TOAST
          : res.throttled
            ? BUSY_TOAST
            : res.pending
              ? QUEUED_TOAST
              : loggedToast(dogName(load.dog.name)),
      );
      setNote(quiet);
      // A second line to read: give it a second longer before leaving.
      leaveTimer.current = setTimeout(() => routerRef.current.push("/me"), quiet ? 3400 : 2200);
    } catch {
      setError("Could not log the feed. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, done, file, load, myFirstName, outcome, streakDays, tellCo, unwellNote]);

  const changeHref = `/scan?intent=feed${slug ? `&dog=${encodeURIComponent(slug)}` : ""}`;

  if (saved) {
    const count = waiting.length;
    return (
      <div className={styles.page}>
        {(offlineNow || count > 0) && (
          <div className={styles.offlineBanner} role="status">
            <span>{offlineNow ? offlineBanner(count) : `Sending · ${count} ${count === 1 ? "feed" : "feeds"} waiting`}</span>
            <span className={styles.offlineAuto}>Auto-sends</span>
          </div>
        )}
        <div className={`${styles.body} ${styles.savedBody}`}>
          <span className={styles.savedCheck} aria-hidden="true">
            <StatusIcon name="check" size={30} strokeWidth={2.2} />
          </span>
          <h1 className={styles.title}>{saved.name}&rsquo;s feed is saved.</h1>
          <p className={styles.state}>{OFFLINE_BODY}</p>
          {count > 0 && (
            <ul className={styles.waitList} aria-label="Waiting to send">
              {waiting.map((w) => (
                <li key={w.id} className={styles.waitRow}>
                  <span>{waitingLine(w)}</span>
                  <span className={styles.waitTag}>Waiting</span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.sosNote}>{careNumbers.length > 0 ? SOS_NEEDS_SIGNAL : SOS_NEEDS_SIGNAL_NONE}</p>
          {careNumbers.length > 0 && (
            <ul className={styles.waitList} aria-label="Vets and NGOs for your wards">
              {careNumbers.map((n) => (
                <li key={n.id} className={styles.waitRow}>
                  <span className={styles.careName}>{n.name}</span>
                  <a href={telHref(n.phoneE164)} className={styles.careCall}>
                    Call
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <StickyFooter background="mist" className={styles.footer}>
          <Button href="/scan?intent=feed" fullWidth shadow={false}>
            Scan the next dog
          </Button>
        </StickyFooter>
      </div>
    );
  }

  if (fed && load.kind === "ready") {
    const d = load.dog as DogProfileV5;
    return (
      <FeedDone
        dogs={[{ slug: d.slug, name: dogName(d.name), photoUrl: d.photoUrl ?? null, sex: d.sex ?? null }]}
        streakDays={fed.streak}
        note={fed.note}
        firstFeed={fed.first}
      />
    );
  }

  const noDogView = (): React.JSX.Element => (
    <div className={styles.page}>
      <div className={styles.top}>
        <Link href="/me" className={styles.cancel}>
          Cancel
        </Link>
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>Log a feed</h1>
        <p className={styles.state}>Scan the collar of the dog you fed.</p>
      </div>
      <StickyFooter background="mist" className={styles.footer}>
        <Button href={changeHref} fullWidth>
          Scan a collar
        </Button>
      </StickyFooter>
    </div>
  );

  // V11: no dog in the link, so ask who was fed on this round.
  if (load.kind === "no-dog") return <FeedRound onEmpty={noDogView} />;

  if (load.kind !== "ready") {
    const msg =
      load.kind === "loading"
        ? null
        : load.kind === "not-found"
          ? "No dog with that code. Check the letters and try again."
          : load.message;
    return (
      <div className={styles.page}>
        <div className={styles.top}>
          <Link href="/me" className={styles.cancel}>
            Cancel
          </Link>
        </div>
        <div className={styles.body}>
          <h1 className={styles.title}>Log a feed</h1>
          {msg && (
            <p className={styles.state} role="alert">
              {msg}
            </p>
          )}
        </div>
        {load.kind !== "loading" && (
          <StickyFooter background="mist" className={styles.footer}>
            <Button href={changeHref} fullWidth>
              Scan a collar
            </Button>
          </StickyFooter>
        )}
      </div>
    );
  }

  const dog = load.dog;
  const name = dogName(dog.name);
  const p = pronouns(sexOf(dog));
  const co = coFeeders((dog as DogProfileV5).feeders, myFirstName);
  const coNames = coFeederNames(co);
  const telling = outcome === "unwell" && tellCo && co.length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <Link href="/me" className={styles.cancel}>
          Cancel
        </Link>
      </div>

      <div className={styles.body}>
        <h1 className={styles.title}>Feeding {name}</h1>

        <div className={styles.dogCard}>
          <DogAvatar id={dog.slug} name={name} photoUrl={dog.photoUrl ?? null} size={56} />
          <div className={styles.dogText}>
            <div className={styles.dogName}>{name}</div>
            <div className={styles.dogCode} aria-label={`Collar code ${dog.slug.split("").join(" ")}`}>
              {collarGroups(dog.slug).join(" ")}
            </div>
          </div>
          <Link href={changeHref} className={styles.change}>
            Change
          </Link>
        </div>

        <label className={styles.photo} data-filled={preview ? "true" : undefined}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.fileInput}
            onChange={(e) => {
              pickFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`Your photo of ${name}`} className={styles.photoImg} />
          ) : (
            <span className={styles.photoEmpty}>
              <PhotoIcon />
              <span className={styles.photoCap}>Add a photo (optional)</span>
            </span>
          )}
        </label>
        {file && (
          <button type="button" className={styles.removePhoto} onClick={() => pickFile(null)}>
            Remove photo
          </button>
        )}

        <div className={styles.outcome}>
          <div className={styles.outcomeLabel} id="feed-outcome-label">
            {p.subject === "they" ? "How were they?" : `How was ${p.subject}?`}
          </div>
          <div className={styles.chips} role="group" aria-labelledby="feed-outcome-label">
            {OUTCOMES.map((o) => {
              const on = outcome === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  className={[styles.chip, on ? styles.chipOn : ""].filter(Boolean).join(" ")}
                  aria-pressed={on}
                  onClick={() => setOutcome(on ? null : o.value)}
                >
                  {on && <StatusIcon name="check" size={14} strokeWidth={2.4} />}
                  {o.label}
                </button>
              );
            })}
          </div>
          {outcome === "unwell" && (
            <div className={styles.unwellCard} data-testid="unwell-hint">
              {co.length > 0 && (
                <div className={styles.tellRow}>
                  <span className={styles.tellText}>
                    <span className={styles.tellTitle} id="tell-co">
                      {coNames ? `Tell ${coNames}` : `Tell ${p.possessive} other feeders`}
                    </span>
                    <span className={styles.tellSub}>
                      {coNames ? `${coNames} ${co.length === 1 ? "feeds" : "feed"}` : "They feed"} {p.object} too. A
                      note, not an alarm.
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tellCo}
                    aria-labelledby="tell-co"
                    className={tellCo ? `${styles.switch} ${styles.switchOn}` : styles.switch}
                    onClick={() => setTellCo((t) => !t)}
                  >
                    <span className={styles.knob} />
                  </button>
                </div>
              )}
              <input
                className={styles.noteInput}
                placeholder="What did you notice? (optional)"
                aria-label="What did you notice? (optional)"
                value={unwellNote}
                maxLength={NOTE_MAX}
                onChange={(e) => setUnwellNote(e.target.value)}
              />
              <a href={`/d/${dog.slug}`} className={styles.sosLink}>
                It&rsquo;s serious. Raise an SOS ›
              </a>
            </div>
          )}
        </div>
      </div>

      <StickyFooter
        background="mist"
        className={styles.footer}
        caption={streakDays !== null ? streakCaption(streakDays) : undefined}
        captionPosition="above"
      >
        {toast && (
          <p className={styles.toast} role="status">
            {toast}
            {note && (
              <span className={styles.toastNote} data-testid="feed-note">
                {note}
              </span>
            )}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button fullWidth onClick={() => void submit()} disabled={busy || done} aria-busy={busy || undefined}>
          {logLabel(telling, coNames)}
        </Button>
      </StickyFooter>
    </div>
  );
}
