"use client";

import { useId, useState } from "react";
import styles from "./HungerSlider.module.css";

/**
 * "How hungry is Bruno?": Hetja's answer to Sidehoe's Tone Control toy.
 * Drag the slider and the dog's message bubble rewrites itself.
 *
 * It is a native <input type="range"> (arrow keys, Home/End, touch, and the
 * platform's own slider semantics for free) with `aria-valuetext` set to the
 * stop's name, so a screen reader says "Hungry", not "2". The bubble is an
 * aria-live="polite" region: the rewrite is announced after the value,
 * without interrupting it. The stop labels under the track are clickable
 * shortcuts for pointer users only; the slider already covers keyboard.
 */

export interface HungerStop {
  label: string;
  text: string;
}

export const DEFAULT_HUNGER_STOPS: HungerStop[] = [
  { label: "Just ate", text: "Thank you. I will now nap in the exact middle of the lane." },
  { label: "Peckish", text: "I could eat. Not saying I will. Not saying I won't." },
  { label: "Hungry", text: "Hi. You smell like Parle-G. Is that for me? It's for me." },
  { label: "Very hungry", text: "Nobody has fed me since 2019. (Priya fed me at 7.)" },
  { label: "Will stare at you", text: "(Stares. Blinks slowly. Keeps staring.)" },
];

export interface HungerSliderProps {
  stops?: HungerStop[];
  /** Visible question / slider label. */
  question?: string;
  /** Who is "speaking" in the bubble (for the live region). */
  dog?: string;
  defaultIndex?: number;
  value?: number;
  onChange?: (index: number) => void;
  className?: string;
}

export function HungerSlider({
  stops = DEFAULT_HUNGER_STOPS,
  question,
  dog = "Bruno",
  defaultIndex = 2,
  value,
  onChange,
  className,
}: HungerSliderProps): React.JSX.Element {
  const id = useId();
  const [inner, setInner] = useState(clamp(defaultIndex, stops.length));
  const index = clamp(value ?? inner, stops.length);
  const stop = stops[index];

  const set = (i: number): void => {
    const next = clamp(i, stops.length);
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  return (
    <div className={`${styles.root} ${className ?? ""}`}>
      <div className={styles.convo}>
        <p className="h-bubble">{question ?? `How hungry are you, ${dog}?`}</p>
        <p className={`h-bubble h-bubble-me ${styles.reply}`} aria-live="polite" aria-atomic="true">
          <span className="h-sr-only">{dog}: </span>
          <span key={index} className={styles.replyText}>
            {stop?.text}
          </span>
        </p>
      </div>
      <div className={styles.control}>
        <label htmlFor={id} className="h-sr-only">
          {question ?? `How hungry is ${dog}?`}
        </label>
        <input
          id={id}
          type="range"
          className={styles.range}
          min={0}
          max={stops.length - 1}
          step={1}
          value={index}
          aria-valuetext={stop?.label}
          onChange={(e) => set(Number(e.target.value))}
          style={{ "--p": `${(index / Math.max(1, stops.length - 1)) * 100}%` } as React.CSSProperties}
        />
        <div className={styles.scale} aria-hidden="true">
          {stops.map((s, i) => (
            <span key={s.label} data-on={i === index ? "" : undefined} onClick={() => set(i)}>
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function clamp(i: number, n: number): number {
  return Math.min(Math.max(0, Math.round(i)), Math.max(0, n - 1));
}
