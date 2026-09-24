"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Chat.module.css";

/**
 * Chat: the feed log told as iMessage (Sidehoe .bubble/.typing/.stamp/
 * .receipt and its play() loop).
 *
 *   <Bubble from="me">Fed Bruno 🍚</Bubble>
 *   <TypingDots />
 *   <Stamp><b>Today</b> 9:41 AM</Stamp>
 *   <Receipt>Delivered</Receipt>
 *   <ChatPlayer history={…} script={…} header={…} />
 *
 * ChatPlayer shows `history` instantly, then plays `script` one message at a
 * time: "them" messages are preceded by typing dots for a time proportional
 * to their length (Sidehoe: min(1500, 600 + 11ms × chars)); "me" messages
 * after a 1 s beat. Clicking/pressing the header replays from the top.
 *
 * Content-first: the server (and jsdom, and reduced motion, and browsers
 * without IntersectionObserver) render the WHOLE conversation. Playback only
 * starts once the thread scrolls into view, so a thread in a bento tile far
 * down the page isn't already over by the time anyone reaches it.
 */

export type ChatMessage =
  | { from: "me" | "them"; text: ReactNode; gap?: boolean; key?: string }
  | { stamp: ReactNode; key?: string };

export interface BubbleProps {
  from?: "me" | "them";
  /** Extra space above (a new turn in the conversation). */
  gap?: boolean;
  /** Play the pop-in animation. */
  pop?: boolean;
  children: ReactNode;
  className?: string;
}

export function Bubble({ from = "them", gap, pop, children, className }: BubbleProps): React.JSX.Element {
  const cls = [
    "h-bubble",
    from === "me" ? "h-bubble-me" : "",
    styles.bubble,
    gap ? styles.gap : "",
    pop ? styles.pop : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} data-from={from}>
      {children}
    </span>
  );
}

export function TypingDots({ gap, className }: { gap?: boolean; className?: string }): React.JSX.Element {
  return (
    <span
      className={["h-bubble", styles.bubble, styles.typing, styles.pop, gap ? styles.gap : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label="Typing"
      data-typing=""
    >
      <i />
      <i />
      <i />
    </span>
  );
}

/** Centred timestamp: <Stamp><b>Today</b> 9:41 AM</Stamp>. */
export function Stamp({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <span className={[styles.stamp, className ?? ""].filter(Boolean).join(" ")}>{children}</span>;
}

/** Right-aligned delivery note under the last sent bubble: "Delivered", "Read 9:42 AM". */
export function Receipt({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <span className={[styles.receipt, className ?? ""].filter(Boolean).join(" ")}>{children}</span>;
}

function renderMessage(m: ChatMessage, key: string | number, pop: boolean): React.JSX.Element {
  if ("stamp" in m) return <Stamp key={key}>{m.stamp}</Stamp>;
  return (
    <Bubble key={key} from={m.from} gap={m.gap} pop={pop}>
      {m.text}
    </Bubble>
  );
}

function textLength(node: ReactNode): number {
  if (typeof node === "string" || typeof node === "number") return String(node).length;
  if (Array.isArray(node)) return node.reduce<number>((n, c) => n + textLength(c), 0);
  return 40;
}

export interface ChatPlayerProps {
  /** Already in the thread when it appears (no animation). */
  history?: readonly ChatMessage[];
  /** Played in, one by one. */
  script: readonly ChatMessage[];
  /** Thread header (avatar + name). Clicking it replays. */
  header?: ReactNode;
  /** Show the iMessage composer bar at the bottom (phone screens). */
  composer?: boolean;
  /** Composer placeholder. */
  placeholder?: string;
  /** Pause before the first scripted message, ms. Default 1900 (Sidehoe). */
  startDelay?: number;
  /** Accessible name of the message list. */
  label?: string;
  className?: string;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function ChatPlayer({
  history = [],
  script,
  header,
  composer = false,
  placeholder = "iMessage",
  startDelay = 1900,
  label = "Conversation",
  className,
}: ChatPlayerProps): React.JSX.Element {
  // null = static (everything shown, SSR/fallback). A number = messages of the
  // script revealed so far during playback.
  const [count, setCount] = useState<number | null>(null);
  const [typing, setTyping] = useState<{ gap?: boolean } | null>(null);
  const runRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const playable = useRef(false);

  const play = useCallback(async () => {
    if (!playable.current) return;
    const id = ++runRef.current;
    stickRef.current = true;
    setTyping(null);
    setCount(0);
    await wait(startDelay);
    for (let i = 0; i < script.length; i++) {
      if (id !== runRef.current) return;
      const m = script[i]!;
      if ("from" in m && m.from === "them") {
        setTyping({ gap: m.gap });
        await wait(Math.min(1500, 600 + textLength(m.text) * 11));
        if (id !== runRef.current) return;
        setTyping(null);
      } else if ("from" in m) {
        await wait(1000);
        if (id !== runRef.current) return;
      }
      setCount(i + 1);
      await wait("from" in m && m.from === "me" ? 450 : 320);
    }
  }, [script, startDelay]);

  // Start once in view; never under reduced motion / without IO.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    playable.current = true;
    const run = runRef; // a counter, not a DOM node: always read it live
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void play();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      run.current++; // cancels any in-flight playback
    };
  }, [play]);

  // Keep pinned to the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = msgsRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [count, typing]);

  const onScroll = () => {
    const el = msgsRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void play();
    }
  };

  const shown = count === null ? script : script.slice(0, count);

  return (
    <div ref={rootRef} className={[styles.player, className ?? ""].filter(Boolean).join(" ")} data-chat-player="">
      {header ? (
        <div
          className={styles.head}
          role="button"
          tabIndex={0}
          title="Replay conversation"
          aria-label="Replay conversation"
          onClick={() => void play()}
          onKeyDown={onKey}
        >
          {header}
        </div>
      ) : null}
      <div
        ref={msgsRef}
        className={styles.msgs}
        tabIndex={0}
        aria-label={label}
        onScroll={onScroll}
        data-chat-messages=""
      >
        {history.map((m, i) => renderMessage(m, m.key ?? `h${i}`, false))}
        {shown.map((m, i) => renderMessage(m, m.key ?? `s${i}`, count !== null))}
        {typing ? <TypingDots gap={typing.gap} /> : null}
      </div>
      {composer ? (
        <div className={styles.composer} aria-hidden="true">
          <span className={styles.plus}>+</span>
          <span className={styles.field}>{placeholder}</span>
        </div>
      ) : null}
    </div>
  );
}
