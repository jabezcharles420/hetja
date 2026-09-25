"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { wardDisplay } from "@hetja/contracts";
import { CareTop } from "@/components/care/CareTop";
import care from "@/components/care/care.module.css";
import {
  api,
  ApiError,
  getAccessToken,
  type DogProfileV5,
  type StatusReport,
  type StatusReportKind,
} from "@/lib/api";
import { daysSince, pronouns } from "@/lib/care-copy";
import { dogName } from "@/lib/streak";
import styles from "./status.module.css";

/**
 * N9 "Update on Moti" (design v5): not seen lately, adopted or moved to a
 * shelter, or passed away. Handled gently: the memorial background, a dark
 * button rather than a blue one, and plain words.
 *
 * "Passed away" never takes effect on one feeder's word: the API holds it
 * until a DIFFERENT feeder of the dog confirms it. A second feeder who opens
 * this page while such a report is pending sees the confirm screen instead.
 */

export const PASSED_FOOTNOTE =
  "A dog who has passed keeps their page, with the names of everyone who fed them. Their code is never reused.";

/** The dark button's label follows the choice. Only "not seen" is in the mock. */
export function statusButtonLabel(kind: StatusReportKind, name: string, wardCode: string | null): string {
  switch (kind) {
    case "not_seen":
      return wardCode ? `Ask ${wardCode} feeders to look` : "Ask feeders to look";
    case "adopted":
      return `Mark ${name} as rehomed`;
    case "passed_away":
    default:
      return "Ask a second feeder to confirm";
  }
}

/** "Nobody has logged Moti in 9 days." and its gentler recent forms. */
export function lastLoggedLine(name: string, lastFedAt: string | null | undefined, now = Date.now()): string {
  if (!lastFedAt) return `Nobody has logged ${name} yet.`;
  const days = daysSince(lastFedAt, now);
  if (days === 0) return `${name} was logged today.`;
  if (days === 1) return `${name} was last logged yesterday.`;
  return `Nobody has logged ${name} in ${days} days.`;
}

type Load =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error" }
  | { kind: "ready"; dog: DogProfileV5; pending: StatusReport[] };

type Done = { kind: StatusReportKind | "confirmed"; needsConfirmation?: boolean };

export default function StatusScreen({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [choice, setChoice] = useState<StatusReportKind>("not_seen");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [notSure, setNotSure] = useState(false);

  const here = `/me/dogs/${slug}/status`;

  const fetchAll = useCallback(async () => {
    try {
      const dog = (await api.getDog(slug)) as DogProfileV5;
      let pending: StatusReport[] = [];
      try {
        pending = (await api.getStatusReports(slug)).reports;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw err;
        if (err instanceof ApiError && err.status === 403) {
          setLoad({ kind: "hidden" });
          return;
        }
        // Anything else: the form still works; a pending report just is not shown.
      }
      setLoad({ kind: "ready", dog, pending });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
        return;
      }
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setLoad({ kind: "hidden" });
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

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createStatusReport(slug, choice);
      setDone({ kind: choice, needsConfirmation: r.needsConfirmation });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
        return;
      }
      setError(
        err instanceof ApiError && err.status === 403
          ? "Only feeders of this dog can send an update."
          : err instanceof ApiError && err.status === 409
            ? "An update like this is already waiting."
            : "Hetja could not be reached. Try again in a minute.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, choice, slug, here]);

  const confirm = useCallback(
    async (reportId: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await api.confirmStatusReport(slug, reportId);
        setDone({ kind: "confirmed" });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
          return;
        }
        setError(
          err instanceof ApiError && err.status === 403
            ? "A different feeder from the one who reported it has to confirm."
            : "Hetja could not be reached. Try again in a minute.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, slug, here],
  );

  if (load.kind !== "ready") {
    return (
      <div className={`${care.page} ${care.memorial}`}>
        <CareTop back="My dogs" href="/me/dogs" />
        <div className={care.body}>
          {load.kind === "loading" ? (
            <p className={care.lead} role="status">
              Loading.
            </p>
          ) : load.kind === "hidden" ? (
            <>
              <h1 className={care.title}>Only this dog&rsquo;s feeders can send an update.</h1>
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

  const { dog, pending } = load;
  const name = dogName(dog.name);
  const p = pronouns(dog.sex);
  const wardCode = dog.wardId ? wardDisplay(dog.wardId).code : null;
  const back = <CareTop back={name} href={`/d/${dog.slug}`} />;
  const othersPassed = pending.find((r) => r.kind === "passed_away" && !r.mine);
  const minePassed = pending.find((r) => r.kind === "passed_away" && r.mine);

  // --- After sending ------------------------------------------------------
  if (done) {
    const { title, body } =
      done.kind === "confirmed"
        ? {
            title: "Thank you for confirming.",
            body: `${name}'s page stays, with the names of everyone who fed ${p.object}. ${name}'s code is never reused.`,
          }
        : done.kind === "not_seen"
          ? {
              title: `${wardCode ?? "Nearby"} feeders will look out for ${name}.`,
              body: `If anyone feeds or scans ${name}, ${p.possessive} page goes back to normal on its own.`,
            }
          : done.kind === "adopted"
            ? {
                title: `${name}'s page stays.`,
                body: `Feeding reminders for ${name} stop. Thank you for looking after ${p.object}.`,
              }
            : done.needsConfirmation === false
              ? {
                  title: "Thank you for telling us.",
                  body: `${name}'s page stays, with the names of everyone who fed ${p.object}.`,
                }
              : {
                  title: "Thank you for telling us.",
                  body: `Another feeder of ${name} will be asked to confirm. Until then, ${p.possessive} page stays as it is.`,
                };
    return (
      <div className={`${care.page} ${care.memorial}`}>
        {back}
        <div className={`${care.body} ${styles.body}`}>
          <h1 className={care.title}>{title}</h1>
          <p className={care.lead} role="status">
            {body}
          </p>
        </div>
        <div className={styles.footer}>
          <Link href="/me/dogs" className={care.dark}>
            Back to My dogs
          </Link>
        </div>
      </div>
    );
  }

  // --- Already passed ------------------------------------------------------
  if (dog.status === "deceased") {
    return (
      <div className={`${care.page} ${care.memorial}`}>
        {back}
        <div className={`${care.body} ${styles.body}`}>
          <h1 className={care.title}>{name} has passed away.</h1>
          <p className={care.lead}>{PASSED_FOOTNOTE}</p>
        </div>
      </div>
    );
  }

  // --- A second feeder confirms --------------------------------------------
  if (othersPassed && !notSure) {
    const who = othersPassed.reportedByName ?? "Another feeder";
    return (
      <div className={`${care.page} ${care.memorial}`}>
        {back}
        <div className={`${care.body} ${styles.body}`}>
          <h1 className={care.title}>{name} may have passed away.</h1>
          <p className={care.lead}>
            {who} said {name} has passed away. If you know this is true, you can confirm it. If you&rsquo;re not sure, leave
            it: nothing changes on one feeder&rsquo;s word.
          </p>
          <p className={`${care.foot} ${care.foot14}`}>{PASSED_FOOTNOTE}</p>
          {error && (
            <p className={care.alert} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className={care.dark}
            onClick={() => void confirm(othersPassed.id)}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            Yes, {name} has passed
          </button>
          <button type="button" className={care.textBtn} onClick={() => setNotSure(true)}>
            I&rsquo;m not sure
          </button>
        </div>
      </div>
    );
  }

  // --- The form (N9) -------------------------------------------------------
  const options: { kind: StatusReportKind; title: string; sub: string }[] = [
    {
      kind: "not_seen",
      title: "Not seen lately",
      sub: wardCode ? `Asks feeders in ${wardCode} to look out` : "Asks nearby feeders to look out",
    },
    { kind: "adopted", title: "Adopted or moved to a shelter", sub: "Profile stays, feeding stops" },
    { kind: "passed_away", title: `${name} has passed away`, sub: "Needs a second feeder to confirm" },
  ];

  return (
    <div className={`${care.page} ${care.memorial}`}>
      {back}
      <div className={`${care.body} ${styles.body}`}>
        <h1 className={care.title}>Update on {name}</h1>
        <p className={care.lead}>{lastLoggedLine(name, dog.lastFedAt)}</p>

        <div className={styles.group} role="radiogroup" aria-label={`Update on ${name}`}>
          {options.map((o) => {
            const on = choice === o.kind;
            return (
              <button
                key={o.kind}
                type="button"
                role="radio"
                aria-checked={on}
                className={styles.option}
                onClick={() => setChoice(o.kind)}
              >
                <span className={[styles.radio, on ? styles.radioOn : ""].filter(Boolean).join(" ")} aria-hidden />
                <span className={styles.optionText}>
                  <span className={styles.optionTitle}>{o.title}</span>
                  <span className={styles.optionSub}>{o.sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        {minePassed && (
          <p className={`${care.foot} ${care.foot14}`} role="status">
            You said {name} has passed away. It is waiting for a second feeder to confirm.
          </p>
        )}
        <p className={`${care.foot} ${care.foot14}`}>{PASSED_FOOTNOTE}</p>
        {error && (
          <p className={care.alert} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={care.dark}
          onClick={() => void submit()}
          disabled={busy || (choice === "passed_away" && !!minePassed)}
          aria-busy={busy || undefined}
        >
          {statusButtonLabel(choice, name, wardCode)}
        </button>
      </div>
    </div>
  );
}
