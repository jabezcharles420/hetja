"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../Icon";
import { prefersReducedMotion } from "./env";
import styles from "./Gallery.module.css";

/**
 * <Gallery> is the apple.com horizontal "gallery": native scroll-snap cards
 * that peek at the edges, a dot pill whose active dot stretches and fills
 * while autoplay runs, prev/next buttons and a visible Pause/Play control.
 *
 * Scrolling is the browser's own (swipe, trackpad, keyboard on the focused
 * track), so it is smooth and never fights the user. JS only tracks which
 * slide is centred and drives autoplay.
 *
 * WCAG 2.2.2 (Pause, Stop, Hide): autoplay always comes with a real,
 * focusable Pause button whose label says what it will do. Autoplay also
 * pauses on hover, on keyboard focus inside, while offscreen and while the
 * tab is hidden, and stops for good once the user navigates themselves
 * (APG carousel pattern). Under reduced motion it never starts on its own;
 * the viewer can still press Play.
 */

export interface GalleryItem {
  id: string;
  /** Short name read with "2 of 5" by screen readers. */
  label: string;
  content: ReactNode;
}

export interface GalleryProps {
  items: GalleryItem[];
  /** Accessible name for the carousel ("Stories from Dadar West"). */
  label: string;
  /** Advance on a timer. Default false. */
  autoplay?: boolean;
  /** Milliseconds per slide. Default 5000. */
  interval?: number;
  /** Slide width (any CSS length). Default min(82%, 420px). */
  slideWidth?: string;
  className?: string;
}

/** The track's snap edge in px, measured as where the first slide sits inside
 * the track (its padding-left, which the CSS sets equal to scroll-padding).
 * Not read from getComputedStyle: scroll-padding comes back as the unresolved
 * `max(22px, 50% - 540px)` expression, which parses to NaN. 0 in jsdom. */
function snapEdge(track: HTMLElement): number {
  const first = track.children[0] as HTMLElement | undefined;
  return first ? first.offsetLeft - track.offsetLeft : 0;
}

function PlayGlyph({ playing }: { playing: boolean }): React.JSX.Element {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      {playing ? (
        <>
          <rect x="3" y="2" width="3" height="10" rx="1" />
          <rect x="8" y="2" width="3" height="10" rx="1" />
        </>
      ) : (
        <path d="M4 2.2v9.6a.7.7 0 0 0 1.06.6l7.7-4.8a.7.7 0 0 0 0-1.2L5.06 1.6A.7.7 0 0 0 4 2.2z" />
      )}
    </svg>
  );
}

export function Gallery({
  items,
  label,
  autoplay = false,
  interval = 5000,
  slideWidth,
  className,
}: GalleryProps): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const count = items.length;
  const running = playing && !hover && !focusIn && onScreen && pageVisible && count > 1;

  // Autoplay starts after mount, never under reduced motion.
  useEffect(() => {
    if (autoplay && !prefersReducedMotion()) setPlaying(true);
  }, [autoplay]);

  // Pause while offscreen and while the tab is hidden.
  useEffect(() => {
    const el = rootRef.current;
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
      io.observe(el);
    }
    const vis = (): void => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", vis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const scrollToSlide = useCallback((i: number) => {
    const track = trackRef.current;
    const slide = track?.children[i] as HTMLElement | undefined;
    if (!track || !slide) return;
    // Slides snap to the content-column edge (scroll-padding), not the centre.
    const left = slide.offsetLeft - track.offsetLeft - snapEdge(track);
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (typeof track.scrollTo === "function") track.scrollTo({ left, behavior });
    else track.scrollLeft = left;
  }, []);

  const go = useCallback(
    (i: number, byUser: boolean) => {
      const next = Math.max(0, Math.min(count - 1, i));
      setIndex(next);
      scrollToSlide(next);
      if (byUser) setPlaying(false);
    },
    [count, scrollToSlide],
  );

  // Autoplay tick: one timeout per slide, wrapping to the first. Pausing
  // (hover, focus, offscreen) banks the time left, so the fill and the timer
  // resume together instead of restarting.
  const remaining = useRef(interval);
  useEffect(() => {
    remaining.current = interval;
  }, [index, interval]);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = window.setTimeout(() => go(index + 1 >= count ? 0 : index + 1, false), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [running, index, count, go]);

  // Follow manual scrolling: the slide at the snap edge becomes the current
  // one. At the end of the track the last slides cannot reach the edge, so a
  // track scrolled fully right always means the last slide.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      if (track.scrollWidth <= track.clientWidth) return; // no layout (jsdom) or nothing to scroll
      if (track.scrollLeft >= track.scrollWidth - track.clientWidth - 2) {
        setIndex(track.children.length - 1);
        return;
      }
      const edge = track.scrollLeft + snapEdge(track);
      let best = 0;
      let bestD = Infinity;
      Array.from(track.children).forEach((c, i) => {
        const el = c as HTMLElement;
        const d = Math.abs(el.offsetLeft - track.offsetLeft - edge);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setIndex(best);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1, true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1, true);
    }
  };

  const current = items[index];
  const vars = { "--interval": `${interval}ms`, ...(slideWidth ? { "--slide-w": slideWidth } : {}) } as CSSProperties;

  return (
    <section
      ref={rootRef}
      className={[styles.root, className].filter(Boolean).join(" ")}
      aria-roledescription="carousel"
      aria-label={label}
      style={vars}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocusIn(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
      }}
    >
      <div
        ref={trackRef}
        className={styles.track}
        tabIndex={0}
        aria-label={`${label}, use arrow keys to move`}
        onKeyDown={onKeyDown}
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            className={styles.slide}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}: ${item.label}`}
            data-current={i === index ? "" : undefined}
          >
            {item.content}
          </div>
        ))}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.arrow}
          aria-label="Previous slide"
          disabled={index === 0}
          onClick={() => go(index - 1, true)}
        >
          <Icon name="chevron-left" size={18} />
        </button>

        <div className={styles.dots}>
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={styles.dot}
              aria-label={`Show slide ${i + 1}: ${item.label}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i, true)}
            >
              {i === index && playing ? (
                <span
                  key={index}
                  aria-hidden="true"
                  className={styles.fill}
                  data-running={running ? "" : undefined}
                />
              ) : null}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.arrow}
          aria-label="Next slide"
          disabled={index >= count - 1}
          onClick={() => go(index + 1, true)}
        >
          <Icon name="chevron-right" size={18} />
        </button>

        {autoplay ? (
          <button
            type="button"
            className={styles.play}
            aria-label={playing ? "Pause gallery" : "Play gallery"}
            onClick={() => setPlaying((p) => !p)}
          >
            <PlayGlyph playing={playing} />
          </button>
        ) : null}
      </div>

      <p className={styles.sr} aria-live={running ? "off" : "polite"} aria-atomic="true">
        {current ? `Slide ${index + 1} of ${count}: ${current.label}` : ""}
      </p>
    </section>
  );
}
