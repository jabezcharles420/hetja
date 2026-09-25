"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { CareTop } from "@/components/care/CareTop";
import care from "@/components/care/care.module.css";
import {
  api,
  ApiError,
  getAccessToken,
  type CheckupInput,
  type DogProfile,
  type FeederMe,
  type RabiesChoice,
} from "@/lib/api";
import { dogName } from "@/lib/streak";
import styles from "./vet.module.css";

/**
 * N3 "Checkup record" (design v5): a vet account records a checkup, which
 * writes medical records through the ledger (append-only, INVARIANT 8) and
 * verifies the dog. POST /dogs/:slug/checkups.
 *
 * Nothing is preselected, although the mock shows "Given today" and "Yes,
 * confirmed" picked: a checkup is evidence, so every answer has to be the
 * vet's own tap. The button stays off until both segments are answered and
 * "I examined this dog and the photo matches." is ticked.
 */

export const RABIES: { value: RabiesChoice; label: string }[] = [
  { value: "given_today", label: "Given today" },
  { value: "up_to_date", label: "Up to date" },
  { value: "due", label: "Due" },
];

export const NOTE_MAX = 280;

/** Vet accounts only: the role, or a `vet` capability should the API add one. */
export function isVet(me: Pick<FeederMe, "role" | "capabilities">): boolean {
  return me.role === "vet" || (me.capabilities ?? []).includes("vet");
}

/** "YYYY-MM" a year from now (the next rabies booster after a dose today). */
export function aYearFrom(now = new Date()): string {
  return `${now.getFullYear() + 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type Load =
  | { kind: "loading" }
  | { kind: "not-vet" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "ready"; dog: DogProfile };

export default function VetCheckupScreen({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const ids = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [rabies, setRabies] = useState<RabiesChoice | null>(null);
  const [sterilised, setSterilised] = useState<boolean | null>(null);
  const [nextDue, setNextDue] = useState("");
  const [note, setNote] = useState("");
  const [examined, setExamined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const here = `/vet/${slug}`;

  const toLogin = useCallback(() => {
    routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
  }, [here]);

  const fetchAll = useCallback(async () => {
    try {
      const me = await api.getFeederMe();
      if (!isVet(me)) {
        setLoad({ kind: "not-vet" });
        return;
      }
      const dog = await api.getDog(slug);
      setLoad({ kind: "ready", dog });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && err.status === 404) setLoad({ kind: "not-found" });
      else setLoad({ kind: "error" });
    }
  }, [slug, toLogin]);

  useEffect(() => {
    if (!getAccessToken()) {
      toLogin();
      return;
    }
    void fetchAll();
  }, [fetchAll, toLogin]);

  const pickRabies = (v: RabiesChoice) => {
    setRabies(v);
    if (v === "given_today" && !nextDue) setNextDue(aYearFrom());
  };

  const ready = rabies !== null && sterilised !== null && examined;

  const save = useCallback(async () => {
    if (load.kind !== "ready" || !ready || busy || rabies === null || sterilised === null) return;
    setBusy(true);
    setError(null);
    const input: CheckupInput = {
      rabies,
      sterilised,
      examined: true,
      ...(nextDue ? { nextVaccineDue: nextDue } : {}),
      ...(note.trim() ? { noteForFeeders: note.trim() } : {}),
    };
    try {
      await api.createCheckup(load.dog.slug, input);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setError(
        err instanceof ApiError && err.status === 403
          ? "Only vet accounts can add a checkup."
          : err instanceof ApiError && err.status === 400
            ? "Something in the form was not accepted. Check the answers and try again."
            : "Hetja could not be reached. Nothing was saved. Try again in a minute.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, load, nextDue, note, rabies, ready, sterilised, toLogin]);

  if (load.kind !== "ready") {
    return (
      <div className={care.page}>
        <CareTop back="Me" href="/me" />
        <div className={care.body}>
          <h1 className={care.title}>Checkup record</h1>
          {load.kind === "loading" ? (
            <p className={care.lead} role="status">
              Loading.
            </p>
          ) : load.kind === "not-vet" ? (
            <>
              <p className={care.lead}>
                Checkups are recorded by vet accounts, because they go on the dog&rsquo;s medical record for good and
                make the dog verified.
              </p>
              <p className={care.lead}>
                If you are a vet or run a clinic, write to Hetja and we will set up your account. If you fed this dog,
                you can confirm it from My dogs instead.
              </p>
              <div className={styles.stack}>
                <Button href="/contact" fullWidth>
                  Contact Hetja
                </Button>
                <Button href="/me/dogs" variant="link">
                  Open My dogs
                </Button>
              </div>
            </>
          ) : load.kind === "not-found" ? (
            <p className={care.lead} role="alert">
              No dog has this code.
            </p>
          ) : (
            <>
              <p className={care.lead} role="alert">
                Hetja could not be reached. Check your connection and try again.
              </p>
              <button type="button" className={care.textBtn} onClick={() => void fetchAll()}>
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const dog = load.dog;
  const name = dogName(dog.name);
  const top = (
    <CareTop back={name} href={`/d/${dog.slug}`} trailing={<span className={styles.vetPill}>Vet account</span>} />
  );

  if (done) {
    return (
      <div className={care.page}>
        {top}
        <div className={care.body}>
          <h1 className={care.title}>{name} is verified.</h1>
          <p className={care.lead} role="status">
            The checkup is on {name}&rsquo;s record. Feeders see it on the profile.
          </p>
        </div>
        <div className={styles.footer}>
          <Button href={`/d/${dog.slug}`} fullWidth>
            Open {name}&rsquo;s profile
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={care.page}>
      {top}
      <div className={care.body}>
        <h1 className={care.title}>Checkup record</h1>

        <div className={styles.card}>
          <div className={styles.field}>
            <div className={styles.fieldLabel} id={`${ids}-rabies`}>
              Anti-rabies vaccine
            </div>
            <div className={`${styles.segment} ${styles.three}`} role="radiogroup" aria-labelledby={`${ids}-rabies`}>
              {RABIES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={rabies === o.value}
                  className={[styles.seg, rabies === o.value ? styles.segOn : ""].filter(Boolean).join(" ")}
                  onClick={() => pickRabies(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.fieldLabel} id={`${ids}-ster`}>
              Sterilised
            </div>
            <div className={`${styles.segment} ${styles.two}`} role="radiogroup" aria-labelledby={`${ids}-ster`}>
              {[
                { v: true, label: "Yes, confirmed" },
                { v: false, label: "No" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={sterilised === o.v}
                  className={[styles.seg, sterilised === o.v ? styles.segOn : ""].filter(Boolean).join(" ")}
                  onClick={() => setSterilised(o.v)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <label className={styles.inputRow}>
            <span className={styles.inputLabel}>Next vaccine due</span>
            <input
              type="month"
              className={styles.input}
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />
          </label>

          <label className={`${styles.inputRow} ${styles.noteRow}`}>
            <span className={styles.inputLabel}>Note for feeders</span>
            <textarea
              className={`${styles.input} ${styles.note}`}
              value={note}
              maxLength={NOTE_MAX}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            className={styles.checkInput}
            checked={examined}
            onChange={(e) => setExamined(e.target.checked)}
            required
          />
          <span className={styles.checkBox} aria-hidden="true">
            {examined ? "✓" : ""}
          </span>
          <span className={styles.checkText}>I examined this dog and the photo matches.</span>
        </label>

        {error && (
          <p className={care.alert} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className={styles.footer}>
        <Button fullWidth onClick={() => void save()} disabled={!ready || busy} aria-busy={busy || undefined}>
          Save and verify {name}
        </Button>
      </div>
    </div>
  );
}
