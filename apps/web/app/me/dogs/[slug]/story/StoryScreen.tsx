"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, StickyFooter } from "@/components/ds";
import care from "@/components/care/care.module.css";
import { api, ApiError, getAccessToken, type DogProfileV5 } from "@/lib/api";
import { pronouns, sexOf, type Pronouns } from "@/lib/care-copy";
import { dogName } from "@/lib/streak";
import styles from "./story.module.css";

/**
 * N16 "Write the story" (design v6): two or three lines a stranger reads on
 * the dog's page. POST /dogs/:slug/stories, which versions the story and
 * sends it to moderation first (so the page says it shows once read). A
 * 280-character cap here (the API allows more, the design does not), prompt
 * chips, and the ward-not-street reminder (INVARIANT 2 in spirit: a story
 * must not become a precise location).
 */

export const STORY_MAX = 280;
export const PLACE_NOTE = "Landmarks are fine. Leave out house numbers and building names.";

/** The three prompt chips and the sentence each one starts. */
export function prompts(p: Pronouns): { label: string; starter: string }[] {
  const they = p.subject === "they";
  const S = p.subject.charAt(0).toUpperCase() + p.subject.slice(1);
  return [
    { label: `Where ${p.subject} ${they ? "sleep" : "sleeps"}`, starter: `${S} ${they ? "sleep" : "sleeps"} ` },
    { label: `What ${p.subject} ${they ? "love" : "loves"}`, starter: `${S} ${they ? "love" : "loves"} ` },
    { label: `What scares ${p.object}`, starter: `${S} ${they ? "are" : "is"} scared of ` },
  ];
}

/** "It's how a stranger learns he's somebody's." */
export function storyLead(p: Pronouns): string {
  const who = p.subject === "they" ? "they're" : `${p.subject}'s`;
  return `Two or three lines. It's how a stranger learns ${who} somebody's.`;
}

/**
 * Words that usually mean an address rather than a landmark. A gentle nudge,
 * not a block: moderation reads every story anyway.
 */
export function looksLikeAddress(text: string): boolean {
  return /\b(flat|room|house|plot|bldg|building|tower|wing|floor|apartment|apt|society|chs)\b\s*(no\.?|number|#)?\s*\d/i.test(text) ||
    /\b\d{1,4}\s*[/-]\s*\d{1,4}\b/.test(text) ||
    /\b\d{6}\b/.test(text);
}

export default function StoryScreen({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const area = useRef<HTMLTextAreaElement | null>(null);
  const [dog, setDog] = useState<DogProfileV5 | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const here = `/me/dogs/${slug}/story`;

  useEffect(() => {
    if (!getAccessToken()) {
      routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    let live = true;
    api
      .getDog(slug)
      .then((d) => live && setDog(d as DogProfileV5))
      .catch(() => live && setDog(null));
    // Start from the story strangers see today, when there is one.
    api
      .getDogStories(slug)
      .then(({ stories }) => {
        const latest = [...stories].sort((a, b) => b.version - a.version)[0];
        if (live && latest) setText((t) => t || latest.paragraph.slice(0, STORY_MAX));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug, here]);

  const name = dogName(dog?.name);
  const p = pronouns(sexOf(dog));
  const trimmed = text.trim();

  const save = useCallback(async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createStory(slug, trimmed.slice(0, STORY_MAX));
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
        return;
      }
      setError(
        err instanceof ApiError && err.status === 429
          ? "That's five stories today. Try again tomorrow."
          : err instanceof ApiError && err.status === 409
            ? `Stories can only be added while ${name} is active on Hetja.`
            : err instanceof ApiError && err.status === 400
              ? "That story wasn't accepted. Keep it to a few plain lines."
              : "Hetja could not be reached. Your words are still here. Try again in a minute.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, here, name, slug, trimmed]);

  const addPrompt = (starter: string) => {
    setText((t) => {
      const base = t.trimEnd();
      const next = base ? `${base}${/[.!?]$/.test(base) ? "" : "."} ${starter}` : starter;
      return next.slice(0, STORY_MAX);
    });
    requestAnimationFrame(() => {
      const el = area.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  if (saved) {
    return (
      <div className={care.page}>
        <div className={styles.top}>
          <Link href={`/me/dogs/${slug}`} className={care.topLink}>
            ‹ {name}
          </Link>
        </div>
        <div className={`${care.body} ${styles.body}`}>
          <h1 className={styles.title}>Saved.</h1>
          <p className={styles.lead} role="status">
            {name}&rsquo;s story shows on {p.possessive} page once a moderator has read it. That is usually within a day.
          </p>
        </div>
        <StickyFooter background="mist" divider={false}>
          <Button href={`/me/dogs/${slug}`} fullWidth>
            Back to {name}
          </Button>
        </StickyFooter>
      </div>
    );
  }

  return (
    <div className={care.page}>
      <div className={styles.top}>
        <Link href={`/me/dogs/${slug}`} className={care.topLink}>
          Cancel
        </Link>
      </div>
      <div className={`${care.body} ${styles.body}`}>
        <h1 className={styles.title}>{name}&rsquo;s story</h1>
        <p className={styles.lead}>{storyLead(p)}</p>
        <label className={styles.editor}>
          <span className="h-sr-only">{name}&rsquo;s story</span>
          <textarea
            ref={area}
            className={styles.area}
            value={text}
            maxLength={STORY_MAX}
            rows={4}
            onChange={(e) => setText(e.target.value.slice(0, STORY_MAX))}
          />
          <span className={styles.count} aria-live="polite">
            {text.length} / {STORY_MAX}
          </span>
        </label>
        <div className={styles.prompts}>
          <span className={styles.promptLabel} id="story-prompts">
            Stuck? Try
          </span>
          <div className={styles.chips} role="group" aria-labelledby="story-prompts">
            {prompts(p).map((c) => (
              <button key={c.label} type="button" className={styles.chip} onClick={() => addPrompt(c.starter)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.place}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4C5.2 13 3 10.8 3 7.8v-4z" />
          </svg>
          <span>{PLACE_NOTE}</span>
        </p>
        {looksLikeAddress(text) && (
          <p className={styles.warn} role="note">
            That looks like part of an address. A landmark (a bus stop, a temple, a shop) is safer.
          </p>
        )}
        {error && (
          <p className={care.alert} role="alert">
            {error}
          </p>
        )}
      </div>
      <StickyFooter background="mist" divider={false}>
        <Button fullWidth onClick={() => void save()} disabled={!trimmed || busy} aria-busy={busy || undefined}>
          Save story
        </Button>
      </StickyFooter>
    </div>
  );
}
