"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DogAvatar, StatusIcon, StatusPill, StickyFooter } from "@/components/ds";
import { CareTop } from "@/components/care/CareTop";
import care from "@/components/care/care.module.css";
import { api, ApiError, getAccessToken, type DogProfileV5, type DogWeek, type FeedOutcomeValue } from "@/lib/api";
import { pronouns, sexOf } from "@/lib/care-copy";
import { dogName } from "@/lib/streak";
import styles from "./week.module.css";

/**
 * N15 "Your dog, this week" (design v6): the feeder's private view of a dog,
 * opened from My dogs (the public /d/ page is what a stranger sees). Which of
 * the last 7 days she was fed (from everyone's logs, GET /dogs/:slug/week),
 * an outcome worth noticing, the rabies booster, the vet records, and one
 * button: Log a feed. Only feeders of the dog can read the week (403 else).
 */

const OUTCOME_LABEL: Record<FeedOutcomeValue, string> = {
  ate_all: "Ate it all",
  ate_some: "Ate a little",
  didnt_eat: "Didn't eat",
  unwell: "Looks unwell",
};

const NOTABLE: readonly FeedOutcomeValue[] = ["didnt_eat", "unwell"];

function weekday(date: string, style: "narrow" | "long"): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: style, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** "6 of 7 days". */
export function fedCount(days: DogWeek["days"]): string {
  return `${days.filter((d) => d.fed).length} of ${days.length} days`;
}

/**
 * The line under the week: the latest outcome worth noticing, and whether
 * she has been fine since. "Wednesday: Arjun logged "Didn't eat". Fine since
 * Thursday." Null when the week has nothing to say.
 */
export function weekNote(days: DogWeek["days"], name: string): string | null {
  let idx = -1;
  for (let i = days.length - 1; i >= 0; i--) {
    const o = days[i]!.outcome;
    if (o && NOTABLE.includes(o)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    const missed = days.filter((d) => !d.fed);
    if (missed.length === 0) return `${name} was fed every day this week.`;
    return null;
  }
  const d = days[idx]!;
  const who = d.byFirstName ?? "A feeder";
  const line = `${weekday(d.date, "long")}: ${who} logged "${OUTCOME_LABEL[d.outcome!]}".`;
  const after = days.slice(idx + 1);
  const fine = after.length > 0 && after.every((x) => x.fed && (!x.outcome || !NOTABLE.includes(x.outcome)));
  return fine ? `${line} Fine since ${weekday(after[0]!.date, "long")}.` : line;
}

/** "Fed by you and Arjun M.", "Fed by Arjun M. and Meera K.", "Fed by you". */
export function fedByLine(names: string[], me: string | null): string {
  const others = [...names];
  let you = false;
  if (me) {
    const i = others.findIndex((n) => n === me || n.split(" ")[0] === me.split(" ")[0]);
    if (i >= 0) {
      others.splice(i, 1);
      you = true;
    }
  }
  const list = [...(you ? ["you"] : []), ...others];
  if (list.length === 0) return "No feeds logged this week";
  if (list.length === 1) return `Fed by ${list[0]}`;
  if (list.length <= 3) return `Fed by ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `Fed by ${list.slice(0, 2).join(", ")} and ${list.length - 2} others`;
}

/** "8 Oct 2025". */
function longDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

/** The rabies pill: overdue, due within 60 days, or a month. */
export function rabiesPill(dueDate: string, now = Date.now()): { variant: "warn" | "danger" | "ok"; text: string } {
  const days = Math.ceil((Date.parse(`${dueDate}T00:00:00Z`) - now) / 86_400_000);
  if (days < 0) return { variant: "danger", text: "Overdue" };
  if (days === 0) return { variant: "warn", text: "Due today" };
  if (days <= 60) return { variant: "warn", text: `Due in ${days} ${days === 1 ? "day" : "days"}` };
  return {
    variant: "ok",
    text: `Due ${new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${dueDate}T00:00:00Z`))}`,
  };
}

type Load =
  | { kind: "loading" }
  | { kind: "hidden"; name: string | null }
  | { kind: "error" }
  | { kind: "ready"; dog: DogProfileV5; week: DogWeek; me: string | null };

export default function DogWeekScreen({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const here = `/me/dogs/${slug}`;

  const fetchAll = useCallback(async () => {
    let dog: DogProfileV5 | null = null;
    try {
      dog = (await api.getDog(slug)) as DogProfileV5;
    } catch {
      /* the week call decides */
    }
    try {
      const [week, me] = await Promise.all([api.getDogWeek(slug), api.getFeederMe().catch(() => null)]);
      setLoad({
        kind: "ready",
        dog: dog ?? ({ slug, name: null, status: "active", wardId: "", photoKey: null, abcStatus: null, vaccineStatus: null, microStory: null, lastSeenAt: null, geo: null } as DogProfileV5),
        week,
        me: me?.publicName ?? null,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
        return;
      }
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setLoad({ kind: "hidden", name: dog?.name ?? null });
      else setLoad({ kind: "error" });
    }
  }, [slug, here]);

  useEffect(() => {
    if (!getAccessToken()) {
      routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    void fetchAll();
  }, [fetchAll, here]);

  if (load.kind !== "ready") {
    return (
      <div className={care.page}>
        <CareTop back="Me" href="/me" />
        <div className={care.body}>
          {load.kind === "loading" ? (
            <p className={care.lead} role="status">
              Loading.
            </p>
          ) : load.kind === "hidden" ? (
            <>
              <h1 className={care.title}>Only feeders of {dogName(load.name)} see this.</h1>
              <p className={care.lead}>
                Feeders are the person who registered the dog and anyone who has logged a feed in the last 60 days.
              </p>
              <Button href={`/d/${slug}`} variant="link">
                Open the public page
              </Button>
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

  const { dog, week, me } = load;
  const name = dogName(dog.name);
  const p = pronouns(sexOf(dog));
  const note = weekNote(week.days, name);
  const today = week.days.length - 1;
  const rabies = week.rabiesDue;
  const pill = rabies ? rabiesPill(rabies.dueDate) : null;

  return (
    <div className={care.page}>
      <CareTop
        back="Me"
        href="/me"
        trailing={
          <Link href={`/me/dogs/${dog.slug}/story`} className={care.topLink} aria-label={`Edit ${name}'s story`}>
            Edit
          </Link>
        }
      />
      <div className={`${care.body} ${styles.body}`}>
        <div className={styles.head}>
          <DogAvatar id={dog.slug} name={name} photoUrl={dog.photoUrl ?? null} size={56} className={styles.face} />
          <div className={styles.headText}>
            <h1 className={styles.name}>{name}</h1>
            <span className={styles.by}>{fedByLine(week.feederNames, me)}</span>
          </div>
        </div>

        <section className={styles.weekCard} aria-labelledby="week-title">
          <div className={styles.weekHead}>
            <h2 id="week-title" className={styles.weekTitle}>
              This week
            </h2>
            <span className={styles.weekCount}>{fedCount(week.days)}</span>
          </div>
          <ol className={styles.days}>
            {week.days.map((d, i) => {
              const notable = d.outcome && NOTABLE.includes(d.outcome);
              const label = `${weekday(d.date, "long")}: ${
                !d.fed ? "not logged" : notable ? OUTCOME_LABEL[d.outcome!] : "fed"
              }${i === today ? " (today)" : ""}`;
              return (
                <li key={d.date} className={styles.day} aria-label={label}>
                  <span
                    className={[
                      styles.dot,
                      !d.fed ? styles.dotNone : notable ? styles.dotWarn : styles.dotFed,
                      i === today ? styles.dotToday : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-hidden="true"
                  >
                    {!d.fed ? "–" : notable ? "!" : <StatusIcon name="check" size={14} strokeWidth={2.4} />}
                  </span>
                  <span className={i === today ? `${styles.dayLetter} ${styles.dayToday}` : styles.dayLetter} aria-hidden="true">
                    {weekday(d.date, "narrow")}
                  </span>
                </li>
              );
            })}
          </ol>
          {note && <p className={styles.note}>{note}</p>}
        </section>

        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>Rabies booster</span>
              <span className={styles.rowSub}>
                {rabies?.lastGiven ? `Last given ${longDate(rabies.lastGiven)}` : rabies ? "No dose on record" : `No vaccine on ${p.possessive} record yet`}
              </span>
            </span>
            {pill ? (
              <StatusPill variant={pill.variant} icon={pill.variant === "danger" ? "alert" : pill.variant === "ok" ? "check" : "clock"} size="row">
                {pill.text}
              </StatusPill>
            ) : (
              <StatusPill variant="neutral" icon="clock" size="row">
                Unknown
              </StatusPill>
            )}
          </div>
          <a href={`/d/${dog.slug}`} className={styles.row}>
            <span className={styles.rowTitle}>Vet records</span>
            <span className={styles.rowMeta}>{week.vetRecordCount} ›</span>
          </a>
        </div>
      </div>
      <StickyFooter background="mist" divider={false}>
        <Button href={`/feed?dog=${dog.slug}`} fullWidth>
          Log a feed
        </Button>
      </StickyFooter>
    </div>
  );
}
