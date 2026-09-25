"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ds";
import { api, ApiError, type DogCard, type DogLookupResult } from "@/lib/api";
import {
  BOX_LENGTH,
  EMPTY_BOXES,
  MIN_KNOWN,
  UNKNOWN,
  boxesFromCode,
  currentIntent,
  destinationFor,
  isFullCode,
  knownCount,
  matchCountLabel,
  normaliseCode,
  prettyCode,
  queryFromBoxes,
  withIntent,
  type CodeBoxes,
} from "@/lib/scan-code";
import { ChoiceRows, DogList, DogRow, ScanHeader } from "./ScanParts";
import styles from "./CodeScreen.module.css";

/**
 * F2 "Type what you can read" and N8 "No dog has this code." (design v5).
 *
 * Three boxes of three. Whatever is typed is folded the way GET /dogs/lookup
 * folds it (0 is O; 1 and l are I), a `?`, `.` or space skips a character,
 * and anything not yet typed is unknown too. Unknowns show as dots. Once at
 * least 4 characters are known the list of matches narrows as you type
 * (debounced). A full code that is a dog opens it; a full code that is not
 * is N8, with the lookup's one-swap "Did you mean" suggestions when there
 * are any.
 *
 * `?code=` prefills the boxes (the Scan sheet sends a typed code here when
 * it is short or unknown), and `?intent=feed` is kept, so a feeder who came
 * to log a feed lands on Log a feed for the dog they pick.
 */

export const DEBOUNCE_MS = 300;

type Lookup =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "matches"; dogs: DogCard[] }
  | { kind: "miss"; code: string; suggestions: DogCard[] }
  | { kind: "leaving" }
  | { kind: "error"; reason: "offline" | "limited" | "failed" };

const BOX_LABELS = ["Characters 1 to 3", "Characters 4 to 6", "Characters 7 to 9"];

function boxClass(box: string, focused: boolean): string {
  if (focused) return styles.boxActive;
  return box.replaceAll(UNKNOWN, "").length > 0 ? styles.boxFilled : styles.boxEmpty;
}

export default function CodeScreen(): React.JSX.Element {
  const [boxes, setBoxes] = useState<CodeBoxes>(EMPTY_BOXES);
  const [focused, setFocused] = useState<number | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const [intent, setIntent] = useState<string | null>(null);
  const [fakeOpen, setFakeOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([null, null, null]);
  const seq = useRef(0);

  const focusBox = useCallback((i: number) => {
    const el = inputs.current[i];
    if (!el) return;
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // Not every input type supports selection.
    }
  }, []);

  // Prefill from ?code= and keep ?intent=; with nothing to prefill, the
  // cursor starts in box 1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIntent(currentIntent());
    const pre = params.get("code");
    if (pre) {
      const next = boxesFromCode(pre);
      setBoxes(next);
      const firstShort = next.findIndex((b) => b.length < BOX_LENGTH);
      if (firstShort !== -1) focusBox(firstShort);
    } else {
      focusBox(0);
    }
  }, [focusBox]);

  const query = queryFromBoxes(boxes);
  const known = knownCount(query);
  const full = isFullCode(query);

  useEffect(() => {
    const id = ++seq.current;
    if (known < MIN_KNOWN) {
      setLookup({ kind: "idle" });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLookup({ kind: "error", reason: "offline" });
      return;
    }
    setLookup({ kind: "loading" });
    const t = setTimeout(async () => {
      let res: DogLookupResult;
      try {
        res = await api.lookupDogs(query);
      } catch (err) {
        if (id !== seq.current) return;
        const status = err instanceof ApiError ? err.status : 0;
        setLookup({
          kind: "error",
          reason: status === 0 || status === 408 ? "offline" : status === 429 ? "limited" : "failed",
        });
        return;
      }
      if (id !== seq.current) return;
      if (full) {
        if (res.exact) {
          setLookup({ kind: "leaving" });
          window.location.assign(destinationFor({ slug: res.exact.slug, sig: null }, currentIntent()));
          return;
        }
        setLookup({ kind: "miss", code: query, suggestions: res.suggestions ?? [] });
        return;
      }
      setLookup({ kind: "matches", dogs: res.matches ?? [] });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, known, full, retry]);

  // Back online: try the same code again.
  useEffect(() => {
    const again = () => setRetry((n) => n + 1);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, []);

  const setBox = (i: number, raw: string) => {
    // A space typed inside a box is a skip; in a longer paste ("RNI 482 PQ7")
    // it is only the gap between groups.
    const text = raw.length > BOX_LENGTH ? raw.replace(/\s+/g, "") : raw;
    const typed = normaliseCode(text, BOX_LENGTH * (3 - i));
    const next: CodeBoxes = [...boxes];
    if (typed.length > BOX_LENGTH) {
      // A paste (or fast typing) that runs past this box spills into the next.
      for (let j = i; j < 3; j++) next[j] = typed.slice((j - i) * BOX_LENGTH, (j - i + 1) * BOX_LENGTH);
      setBoxes(next);
      const lastFilled = Math.min(2, i + Math.ceil(typed.length / BOX_LENGTH) - 1);
      const target = next[lastFilled].length === BOX_LENGTH && lastFilled < 2 ? lastFilled + 1 : lastFilled;
      focusBox(target);
      return;
    }
    const grew = typed.length > boxes[i].length;
    next[i] = typed;
    setBoxes(next);
    if (grew && typed.length === BOX_LENGTH && i < 2) focusBox(i + 1);
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && boxes[i].length === 0 && i > 0) {
      e.preventDefault();
      const next: CodeBoxes = [...boxes];
      next[i - 1] = next[i - 1].slice(0, -1);
      setBoxes(next);
      focusBox(i - 1);
    } else if (e.key === "ArrowLeft" && i > 0 && e.currentTarget.selectionStart === 0) {
      focusBox(i - 1);
    } else if (e.key === "ArrowRight" && i < 2 && e.currentTarget.selectionStart === boxes[i].length) {
      focusBox(i + 1);
    }
  };

  const typeAgain = () => {
    setBoxes(EMPTY_BOXES);
    setLookup({ kind: "idle" });
    // Focus after the boxes are back on screen.
    setTimeout(() => focusBox(0), 0);
  };

  const findHref = withIntent("/scan/find", intent);
  const dogHref = (dog: DogCard) => destinationFor({ slug: dog.slug, sig: null }, intent);

  if (lookup.kind === "miss") {
    const s = lookup.suggestions;
    return (
      <div className={styles.screen}>
        <ScanHeader href={withIntent("/scan", intent)} />
        <div className={styles.missBody}>
          <p className={styles.missCode} aria-label={`Code ${prettyCode(lookup.code)}`}>
            {prettyCode(lookup.code)}
          </p>
          <h1 className={styles.missTitle}>No dog has this code.</h1>
          {s.length > 0 ? (
            <>
              <p className={styles.missLead}>
                {s.length === 1
                  ? "Two digits may be swapped. Did you mean this dog?"
                  : "Two digits may be swapped. Did you mean one of these dogs?"}
              </p>
              <DogList label="Did you mean">
                {s.map((dog) => (
                  <DogRow key={dog.slug} dog={dog} href={dogHref(dog)} />
                ))}
              </DogList>
            </>
          ) : (
            <p className={styles.missLead}>
              No code on Hetja is one swap or one letter away from it either. Check the tag in better light, or find
              the dog by photo.
            </p>
          )}
          <ChoiceRows
            size="plain"
            items={[
              { title: "Type it again", onClick: typeAgain },
              { title: "Find by ward and photo", href: findHref },
              { title: "Tag looks fake", onClick: () => setFakeOpen(true) },
            ]}
          />
        </div>
        {fakeOpen && <FakeTagSheet findHref={findHref} onClose={() => setFakeOpen(false)} />}
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <ScanHeader href={withIntent("/scan", intent)} />
      <div className={styles.body}>
        <h1 className={styles.title} id="code-title">
          Type what you can read
        </h1>
        <div className={styles.boxes} role="group" aria-labelledby="code-title" aria-describedby="code-help">
          {boxes.map((box, i) => {
            const glyphs = Array.from({ length: BOX_LENGTH }, (_, j) => box[j] ?? UNKNOWN);
            return (
              <div key={i} className={[styles.box, boxClass(box, focused === i)].join(" ")}>
                <span className={styles.glyphs} aria-hidden="true">
                  {glyphs.map((g, j) =>
                    g === UNKNOWN ? (
                      <span key={j} className={styles.dot}>
                        {"·"}
                      </span>
                    ) : (
                      <span key={j}>{g.toUpperCase()}</span>
                    ),
                  )}
                </span>
                <input
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  className={styles.input}
                  value={box.toUpperCase()}
                  onChange={(e) => setBox(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onFocus={() => setFocused(i)}
                  onBlur={() => setFocused((f) => (f === i ? null : f))}
                  aria-label={BOX_LABELS[i]}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint={i < 2 ? "next" : "search"}
                  data-testid={`code-box-${i}`}
                />
              </div>
            );
          })}
        </div>
        <p className={styles.help} id="code-help">
          Skip what you can&apos;t read. 0 and O, 1 and I are treated as the same.
        </p>

        <Results lookup={lookup} known={known} dogHref={dogHref} onRetry={() => setRetry((n) => n + 1)} />
      </div>
      <div className={styles.foot}>
        <Link href={findHref} className={styles.footLink}>
          Can&apos;t read any of it? Find by photo
        </Link>
      </div>
    </div>
  );
}

function Results({
  lookup,
  known,
  dogHref,
  onRetry,
}: {
  lookup: Lookup;
  known: number;
  dogHref: (dog: DogCard) => string;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (lookup.kind === "idle") {
    if (known === 0) return null;
    return (
      <p className={styles.note} role="status">
        Type {MIN_KNOWN - known} more to see matching dogs.
      </p>
    );
  }
  if (lookup.kind === "loading" || lookup.kind === "leaving") {
    return (
      <p className={styles.label} role="status">
        {lookup.kind === "leaving" ? "Opening the dog…" : "Looking…"}
      </p>
    );
  }
  if (lookup.kind === "error") {
    const text =
      lookup.reason === "offline"
        ? "No signal. Matching needs a connection; it tries again when you're back."
        : lookup.reason === "limited"
          ? "That's a lot of tries from this phone. Wait a minute, then try again."
          : "Couldn't check that code right now.";
    return (
      <div className={styles.errorBox} role="alert">
        <p className={styles.note}>{text}</p>
        {lookup.reason !== "offline" && (
          <Button variant="quiet" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (lookup.kind !== "matches") return null;
  const dogs = lookup.dogs;
  if (dogs.length === 0) {
    return (
      <>
        <p className={styles.label} role="status">
          No dogs match
        </p>
        <p className={styles.note}>
          No dog on Hetja has those characters in those places. Skip the ones you&apos;re unsure of.
        </p>
      </>
    );
  }
  return (
    <>
      <p className={styles.label} role="status">
        {matchCountLabel(dogs.length)}
      </p>
      <DogList label="Matching dogs">
        {dogs.map((dog) => (
          <DogRow key={dog.slug} dog={dog} href={dogHref(dog)} />
        ))}
      </DogList>
      <p className={styles.check}>Check the photo before you log anything.</p>
    </>
  );
}

/** N8 "Tag looks fake": there is no report API for a code that is no dog, so this explains what to do. */
function FakeTagSheet({ findHref, onClose }: { findHref: string; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        ref={ref}
        className={styles.fakeSheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fake-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="fake-title" className={styles.fakeTitle}>
          If the tag looks fake
        </h2>
        <p className={styles.fakeText}>
          A Hetja tag has a QR, the 9-character code printed under it, and the dog&apos;s name. A code that finds no
          dog was misread, or the tag is not ours.
        </p>
        <p className={styles.fakeText}>
          Don&apos;t log a feed on it, and don&apos;t pay anyone because of it. If the dog is on Hetja, find them by
          ward and photo, then report the tag from their page so their feeders can reprint it.
        </p>
        <Button href={findHref} fullWidth shadow={false}>
          Find by ward and photo
        </Button>
        <Button variant="link" fullWidth onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
