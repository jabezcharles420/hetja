"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DogAvatar, StatusPill, collarGroups } from "@/components/ds";
import { CareTop } from "@/components/care/CareTop";
import care from "@/components/care/care.module.css";
import { api, ApiError, getAccessToken, type DogProfile, type DogProfileV5, type DogTags, type TagReport } from "@/lib/api";
import { agoWords, dayWords, pronouns, tagCardPill, tagCardTitle, tagEventWords } from "@/lib/care-copy";
import { dogName } from "@/lib/streak";
import styles from "./tag.module.css";

/**
 * F6 "Feeder gets the alert" (design v5, Tag Problems board): an open tag
 * report for one of the caller's dogs, the two ways to fix it, and the tag's
 * history. Only feeders of the dog can read it (the API answers 403 to
 * anyone else).
 *
 * "Reprint tag" goes to the register flow's print screen, which records the
 * print for the history. "I have a spare" resolves the report as `spare`.
 * A "wrong dog" report is not a broken tag: it is checked, not reprinted,
 * and resolving it `checked_ok` clears "Tag under review" on the profile.
 * SOS on that code is never paused while it is open (CONTRACT, adapted list).
 */

type Load =
  | { kind: "loading" }
  | { kind: "hidden"; name: string | null }
  | { kind: "error" }
  | { kind: "ready"; dog: DogProfile; tags: DogTags };

/** The sub line of a report card: "Found near her usual spot · 12 min ago". */
export function reportSub(r: TagReport, possessive: string, now = Date.now()): string {
  const when = agoWords(r.createdAt, now);
  if (r.kind === "found_on_ground") return `Found near ${possessive} usual spot · ${when}`;
  return `Reported by ${r.reporter || "a passer-by"} · ${when}`;
}

export default function TagScreen({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const here = `/me/dogs/${slug}/tag`;

  const toLogin = useCallback(() => {
    routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
  }, [here]);

  const fetchAll = useCallback(async () => {
    let dog: DogProfile | null = null;
    try {
      dog = await api.getDog(slug);
    } catch {
      /* the tags call decides what the page says */
    }
    try {
      const tags = await api.getDogTags(slug);
      setLoad(
        dog
          ? { kind: "ready", dog, tags }
          : {
              kind: "ready",
              dog: {
                slug,
                name: null,
                status: "active",
                wardId: "",
                photoKey: null,
                abcStatus: null,
                vaccineStatus: null,
                microStory: null,
                lastSeenAt: null,
                geo: null,
              },
              tags,
            },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setLoad({ kind: "hidden", name: dog?.name ?? null });
      } else setLoad({ kind: "error" });
    }
  }, [slug, toLogin]);

  useEffect(() => {
    if (!getAccessToken()) {
      toLogin();
      return;
    }
    void fetchAll();
  }, [fetchAll, toLogin]);

  const resolve = useCallback(
    async (report: TagReport, resolution: "spare" | "checked_ok") => {
      if (busy) return;
      setBusy(report.id);
      setError(null);
      try {
        await api.resolveTagReport(slug, report.id, resolution);
        setResolved(resolution);
        try {
          const tags = await api.getDogTags(slug);
          setLoad((l) => (l.kind === "ready" ? { ...l, tags } : l));
        } catch {
          setLoad((l) =>
            l.kind === "ready" ? { ...l, tags: { ...l.tags, open: l.tags.open.filter((o) => o.id !== report.id) } } : l,
          );
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return toLogin();
        setError(
          err instanceof ApiError && err.status === 409
            ? "Another feeder has already sorted this one."
            : "Hetja could not be reached. Try again in a minute.",
        );
        if (err instanceof ApiError && err.status === 409) void fetchAll();
      } finally {
        setBusy(null);
      }
    },
    [busy, fetchAll, slug, toLogin],
  );

  const top = <CareTop back="Me" href="/me" />;

  if (load.kind !== "ready") {
    const name = load.kind === "hidden" ? dogName(load.name) : "this dog";
    return (
      <div className={care.page}>
        {top}
        <div className={care.body}>
          {load.kind === "loading" ? (
            <p className={care.lead} role="status">
              Loading the tag.
            </p>
          ) : load.kind === "hidden" ? (
            <>
              <h1 className={care.title}>Only feeders of {name} see this.</h1>
              <p className={care.lead}>
                Feeders are the person who registered the dog and anyone who has logged a feed in the last 60 days.
              </p>
            </>
          ) : (
            <>
              <h1 className={care.title}>Hetja could not be reached.</h1>
              <p className={care.lead}>Check your connection and try again.</p>
              <button type="button" className={care.textBtn} onClick={() => void fetchAll()}>
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const { dog, tags } = load;
  const name = dogName(dog.name);
  const p = pronouns((dog as DogProfileV5).sex);
  const code = collarGroups(dog.slug).join(" ");
  const printHref = `/register/${dog.slug}/print`;
  // The print screen resolves this report as "reprinted" after the download.
  const reprintHref = (r: TagReport) => `${printHref}?report=${encodeURIComponent(r.id)}`;

  return (
    <div className={care.page}>
      {top}
      <div className={care.body}>
        {tags.open.map((r, i) => {
          const Heading = i === 0 ? "h1" : "h2";
          const wrong = r.kind === "wrong_dog";
          const tight = r.kind === "too_tight";
          return (
            <section key={r.id} className={styles.card} aria-label={tagCardTitle(r.kind, name)}>
              <div className={styles.cardHead}>
                <DogAvatar id={dog.slug} name={name} photoUrl={dog.photoUrl ?? null} size={52} />
                <div className={styles.cardText}>
                  <Heading className={styles.cardTitle}>{tagCardTitle(r.kind, name)}</Heading>
                  <span className={styles.cardSub}>{reportSub(r, p.possessive)}</span>
                </div>
              </div>
              <StatusPill variant="warn" icon={wrong ? "clock" : "alert"} size="row" className={styles.pill}>
                {tagCardPill(r.kind)}
              </StatusPill>
              {wrong && (
                <p className={styles.cardNote}>
                  Feeds on this code earn no trust until a feeder checks. SOS still works.
                </p>
              )}
              <div className={styles.actions}>
                {wrong || tight ? (
                  <>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => void resolve(r, "checked_ok")}
                      disabled={busy !== null}
                      aria-busy={busy === r.id || undefined}
                    >
                      {wrong ? "Checked, tag is right" : "I loosened it"}
                    </button>
                    <Link href={reprintHref(r)} className={styles.quiet}>
                      Reprint tag
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href={reprintHref(r)} className={styles.primary}>
                      Reprint tag
                    </Link>
                    <button
                      type="button"
                      className={styles.quiet}
                      onClick={() => void resolve(r, "spare")}
                      disabled={busy !== null}
                      aria-busy={busy === r.id || undefined}
                    >
                      I have a spare
                    </button>
                  </>
                )}
              </div>
            </section>
          );
        })}

        {tags.open.length === 0 && (
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <DogAvatar id={dog.slug} name={name} photoUrl={dog.photoUrl ?? null} size={52} />
              <div className={styles.cardText}>
                <h1 className={styles.cardTitle}>
                  {resolved === "spare"
                    ? `Thanks. ${name}'s spare tag is noted.`
                    : resolved === "checked_ok"
                      ? `Thanks. ${name}'s tag is checked.`
                      : `${name}'s tag is fine.`}
                </h1>
                <span className={styles.cardSub} role={resolved ? "status" : undefined}>
                  {resolved ? "The report is closed for every feeder." : "No open reports."}
                </span>
              </div>
            </div>
            <Button href={printHref} variant="quiet" size="lg" fullWidth>
              Reprint tag
            </Button>
          </section>
        )}

        {error && (
          <p className={care.alert} role="alert">
            {error}
          </p>
        )}

        <h2 className={care.label}>Tag history · {code}</h2>
        {tags.history.length > 0 ? (
          <ul className={`${care.group} ${styles.history}`}>
            {tags.history.map((e, i) => (
              <li key={`${e.kind}-${e.at}-${i}`} className={care.row}>
                <span>{tagEventWords(e)}</span>
                <span className={care.rowMeta}>{dayWords(e.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={care.foot}>Nothing yet.</p>
        )}

        {tags.sturdierCollarSuggested && (
          <p className={styles.sturdy} role="note">
            {tags.reportsThisWeek} reports this week. {name}&rsquo;s profile now asks for a sturdier collar.
          </p>
        )}
        <p className={care.foot}>
          Only feeders of {name} see this. After 3 reports in a week, {p.possessive} profile asks for a sturdier
          collar.
        </p>
      </div>
    </div>
  );
}
