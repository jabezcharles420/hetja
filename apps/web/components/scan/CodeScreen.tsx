"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ds";
import { api, ApiError, type DogCard, type DogLookupResult } from "@/lib/api";
import {
  BOX_LENGTH,
  MIN_KNOWN,
  UNKNOWN,
  boxesFromCode,
  currentIntent,
  destinationFor,
  isFullCode,
  knownCount,
  matchCountLabel,
  normaliseCode,
  queryFromBoxes,
  withIntent,
  type CodeBoxes,
} from "@/lib/scan-code";
import { DogList, DogRow, ScanHeader } from "./ScanParts";
import FullCode, { type Miss } from "./FullCode";
import styles from "./CodeScreen.module.css";

/**
 * /scan/code: two ways to type a collar code, one route.
 *
 *   V2 / V3 (design v6, FullCode.tsx): one field for the whole printed code,
 *   an "8 / 9" counter, "Find the dog" enabling at 9. A miss is V3 on the
 *   same field ("No dog has this code." / "One letter off. Is it her?").
 *   This is the default: most people can read the whole code.
 *
 *   F2 (design v5, PartialCode below): three boxes of three for a tag that is
 *   only partly readable. `?`, `.` or a space skips a character; from 4 known
 *   characters the matches narrow as you type. Reached from F1's "Type the
 *   code" row (its sub line promises "Part of it is fine."), from V2's "Can't
 *   read all of it?" link, and from the Scan sheet with a short code
 *   (`?code=rni4`). A full code typed into the boxes that is not a dog goes
 *   to V3, which supersedes v5's N8 (v6 CONTRACT, supersedes table).
 *
 * Both fold what is typed the way GET /dogs/lookup folds it (0 is O; 1 and l
 * are I). `?intent=feed` is kept, so a feeder who came to log a feed lands on
 * Log a feed for the dog they pick.
 */

export const DEBOUNCE_MS = 300;

type Lookup =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "matches"; dogs: DogCard[] }
  | { kind: "leaving" }
  | { kind: "error"; reason: "offline" | "limited" | "failed" };

const BOX_LABELS = ["Characters 1 to 3", "Characters 4 to 6", "Characters 7 to 9"];

function boxClass(box: string, focused: boolean): string {
  if (focused) return styles.boxActive;
  return box.replaceAll(UNKNOWN, "").length > 0 ? styles.boxFilled : styles.boxEmpty;
}

type Start = { mode: "full"; code: string } | { mode: "part"; code: string };

/** Which view a URL opens: `?part=1` or a short `?code=` is F2, anything else V2. */
export function startFor(search: string): Start {
  const params = new URLSearchParams(search);
  const code = normaliseCode(params.get("code") ?? "");
  if (params.get("part") === "1") return { mode: "part", code };
  if (code.length > 0 && !isFullCode(code)) return { mode: "part", code };
  return { mode: "full", code };
}

export default function CodeScreen(): React.JSX.Element {
  const [start, setStart] = useState<Start | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [miss, setMiss] = useState<Miss | null>(null);

  useEffect(() => {
    setStart(startFor(window.location.search));
    setIntent(currentIntent());
  }, []);

  // Server render and first paint: V2 without a prefill (the common case).
  const view = start ?? { mode: "full" as const, code: "" };
  if (view.mode === "part") {
    return (
      <PartialCode
        initial={view.code}
        intent={intent}
        onMiss={(m) => {
          setMiss(m);
          setStart({ mode: "full", code: m.code });
        }}
      />
    );
  }
  return (
    <FullCode
      key={`${view.code}:${miss ? "miss" : ""}`}
      initial={view.code}
      initialMiss={miss}
      intent={intent}
      onPartial={() => {
        setMiss(null);
        setStart({ mode: "part", code: "" });
      }}
    />
  );
}

/** F2: three boxes of three, for a tag that is only partly readable. */
export function PartialCode({
  initial,
  intent,
  onMiss,
}: {
  initial: string;
  intent: string | null;
  onMiss: (miss: Miss) => void;
}): React.JSX.Element {
  const [boxes, setBoxes] = useState<CodeBoxes>(() => boxesFromCode(initial));
  const [focused, setFocused] = useState<number | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
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

  // The cursor starts in the first box that still has room.
  useEffect(() => {
    const firstShort = boxes.findIndex((b) => b.length < BOX_LENGTH);
    focusBox(firstShort === -1 ? 2 : firstShort);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMissRef = useRef(onMiss);
  onMissRef.current = onMiss;

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
        onMissRef.current({ code: query, suggestions: res.suggestions ?? [] });
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

  const findHref = withIntent("/scan/find", intent);
  const dogHref = (dog: DogCard) => destinationFor({ slug: dog.slug, sig: null }, intent);

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
