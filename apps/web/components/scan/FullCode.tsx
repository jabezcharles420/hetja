"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { wardDisplay } from "@hetja/contracts";
import { Button, CollarCodeInput, DogAvatar } from "@/components/ds";
import { api, ApiError, type DogCard } from "@/lib/api";
import {
  CODE_LENGTH,
  currentIntent,
  destinationFor,
  diffPositions,
  remainingLabel,
  withIntent,
} from "@/lib/scan-code";
import FakeTagSheet from "./FakeTagSheet";
import { ChoiceRows, ScanHeader } from "./ScanParts";
import styles from "./FullCode.module.css";

/**
 * V2 "Type the code on the collar." and V3 "No dog has this code."
 * (design v6, Polish v2).
 *
 * One field for the whole printed code. A counter replaces the old "too
 * short" error ("One more to go", "8 / 9") and "Find the dog" enables at 9.
 * 0 and O, 1 and I (and l) are folded the way the lookup folds them.
 *
 * A miss turns the same screen into V3: the field keeps the code with an
 * amber ring, and GET /dogs/lookup's near matches (one character off, or one
 * swap) are offered by photo, name and ward so a stranger can confirm without
 * knowing the code. One match is V3 exactly ("Yes, that's Rani" / "Not her.
 * Type it again"); several are a list to pick from; none says so plainly and
 * keeps v5 N8's "Find by ward and photo" and "Tag looks fake". Editing the
 * field goes back to V2.
 */

export interface Miss {
  code: string;
  suggestions: DogCard[];
}

type State =
  | { kind: "typing" }
  | { kind: "checking" }
  | { kind: "leaving" }
  | { kind: "miss"; miss: Miss }
  | { kind: "error"; reason: "offline" | "limited" | "failed" };

function pronouns(dog: DogCard): { ask: string; not: string } {
  if (dog.sex === "female") return { ask: "Is it her?", not: "Not her." };
  if (dog.sex === "male") return { ask: "Is it him?", not: "Not him." };
  const name = dog.name ?? "this dog";
  return { ask: `Is it ${name}?`, not: `Not ${name}.` };
}

/** "R4N 7KW 2AB" with the characters that differ from what was typed marked. */
function MarkedCode({ slug, typed }: { slug: string; typed: string }): React.JSX.Element {
  const diff = diffPositions(typed, slug);
  const chars = slug.toUpperCase().split("");
  return (
    <span className={styles.sugCode}>
      {chars.map((ch, i) => (
        <span key={i}>
          {i > 0 && i % 3 === 0 ? " " : ""}
          {diff.has(i) ? <b className={styles.diff}>{ch}</b> : ch}
        </span>
      ))}
    </span>
  );
}

function wardLine(dog: DogCard): string {
  const d = wardDisplay(dog.wardId);
  const code = dog.wardCode || d.code;
  return d.name ? `${code} ward · ${d.name}` : `${code} ward`;
}

export default function FullCode({
  initial = "",
  initialMiss = null,
  intent,
  onPartial,
}: {
  initial?: string;
  initialMiss?: Miss | null;
  intent: string | null;
  onPartial: () => void;
}): React.JSX.Element {
  const [code, setCode] = useState(initial);
  const [state, setState] = useState<State>(initialMiss ? { kind: "miss", miss: initialMiss } : { kind: "typing" });
  const [fakeOpen, setFakeOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autoRan = useRef(false);

  const leave = (slug: string) => {
    setState({ kind: "leaving" });
    window.location.assign(destinationFor({ slug, sig: null }, currentIntent()));
  };

  const find = async (value: string) => {
    if (value.length !== CODE_LENGTH) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState({ kind: "error", reason: "offline" });
      return;
    }
    setState({ kind: "checking" });
    try {
      const res = await api.lookupDogs(value);
      if (res.exact) {
        leave(res.exact.slug);
        return;
      }
      setState({ kind: "miss", miss: { code: value, suggestions: res.suggestions ?? [] } });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setState({
        kind: "error",
        reason: status === 0 || status === 408 ? "offline" : status === 429 ? "limited" : "failed",
      });
    }
  };

  // Arriving with a whole code (the Scan sheet's typed miss): check it once.
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (initialMiss) return;
    if (initial.length === CODE_LENGTH) void find(initial);
    else inputRef.current?.focus();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeAgain = () => {
    setCode("");
    setState({ kind: "typing" });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const miss = state.kind === "miss" ? state.miss : null;
  const findHref = withIntent("/scan/find", intent);
  const busy = state.kind === "checking" || state.kind === "leaving";
  const sugs = miss?.suggestions ?? [];
  const one = sugs.length === 1 ? sugs[0] : null;

  return (
    <div className={styles.screen}>
      <ScanHeader href={withIntent("/scan", intent)} surface="white" />
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void find(code);
        }}
      >
        <div className={styles.body}>
          <h1 className={styles.title}>Type the code on the collar.</h1>
          {!miss && (
            <p className={styles.lead}>
              Nine letters and numbers, printed under the QR. Capitals or not, it doesn&apos;t matter.
            </p>
          )}
          <CollarCodeInput
            inputRef={inputRef}
            aria-label="Collar code"
            value={code}
            fold
            ghost={false}
            warn={Boolean(miss)}
            onChange={(next) => {
              setCode(next);
              if (state.kind !== "typing" && state.kind !== "checking") setState({ kind: "typing" });
            }}
          />

          {miss ? (
            <>
              <p className={styles.missLine} role="status">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="7" fill="currentColor" />
                  <path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="8" cy="11.3" r="1" fill="#fff" />
                </svg>
                No dog has this code.
              </p>
              {one && (
                <div className={styles.sugCard}>
                  <span className={styles.sugLabel}>One letter off. {pronouns(one).ask}</span>
                  <div className={styles.sugRow}>
                    <DogAvatar id={one.slug} name={one.name ?? ""} photoUrl={one.photoUrl} size={56} />
                    <span className={styles.sugText}>
                      <span className={styles.sugName}>{one.name ?? "No name"}</span>
                      <MarkedCode slug={one.slug} typed={miss.code} />
                      <span className={styles.sugWard}>{wardLine(one)}</span>
                    </span>
                  </div>
                </div>
              )}
              {sugs.length > 1 && (
                <div className={styles.sugCard}>
                  <span className={styles.sugLabel}>One letter off. Is it one of these?</span>
                  <ul className={styles.sugList}>
                    {sugs.map((dog) => (
                      <li key={dog.slug}>
                        <a href={destinationFor({ slug: dog.slug, sig: null }, intent)} className={styles.sugRow}>
                          <DogAvatar id={dog.slug} name={dog.name ?? ""} photoUrl={dog.photoUrl} size={56} />
                          <span className={styles.sugText}>
                            <span className={styles.sugName}>{dog.name ?? "No name"}</span>
                            <MarkedCode slug={dog.slug} typed={miss.code} />
                            <span className={styles.sugWard}>{wardLine(dog)}</span>
                          </span>
                          <span className={styles.chev} aria-hidden="true">
                            ›
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {sugs.length === 0 && (
                <>
                  <p className={styles.lead}>
                    Nothing on Hetja is one letter off either. Check the tag in better light, or find the dog by
                    photo.
                  </p>
                  <ChoiceRows
                    size="plain"
                    tone="mist"
                    items={[
                      { title: "Find by ward and photo", href: findHref },
                      { title: "Tag looks fake", onClick: () => setFakeOpen(true) },
                    ]}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <p className={styles.counter} aria-live="polite">
                <span>{remainingLabel(code.length)}</span>
                <span>
                  {code.length} / {CODE_LENGTH}
                </span>
              </p>
              {state.kind === "error" && (
                <p className={styles.error} role="alert">
                  {state.reason === "offline"
                    ? "No signal. Try again when you're back online."
                    : state.reason === "limited"
                      ? "That's a lot of tries from this phone. Wait a minute, then try again."
                      : "Couldn't check that code right now. Try again."}
                </p>
              )}
              <div className={styles.tip}>
                <span className={styles.tag} aria-hidden="true">
                  R4N 7KW
                </span>
                <span className={styles.tipText}>Easy to mix up: 0 and O, 1 and I. Hetja reads them as the same.</span>
              </div>
              <Link href={withIntent("/scan", intent)} className={styles.textLink}>
                Use the camera instead ›
              </Link>
              <button type="button" className={styles.textLink} onClick={onPartial}>
                Can&apos;t read all of it? Type the part you can ›
              </button>
            </>
          )}
        </div>

        <div className={styles.foot}>
          {miss && one ? (
            <>
              <Button type="button" fullWidth onClick={() => leave(one.slug)}>
                {one.name ? `Yes, that's ${one.name}` : "Yes, that's the dog"}
              </Button>
              <Button type="button" variant="link" fullWidth onClick={typeAgain}>
                {`${pronouns(one).not} Type it again`}
              </Button>
            </>
          ) : miss && sugs.length > 1 ? (
            <Button type="button" variant="link" fullWidth onClick={typeAgain}>
              None of these. Type it again
            </Button>
          ) : miss ? (
            <Button type="button" fullWidth onClick={typeAgain}>
              Type it again
            </Button>
          ) : (
            <Button type="submit" fullWidth disabled={code.length !== CODE_LENGTH || busy}>
              Find the dog
            </Button>
          )}
        </div>
      </form>
      {fakeOpen && <FakeTagSheet findHref={findHref} onClose={() => setFakeOpen(false)} />}
    </div>
  );
}
