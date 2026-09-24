"use client";

import { useId, useState } from "react";
import styles from "./FaqList.module.css";

/**
 * FAQ (Pages 14): category chips that filter one white card of accordion
 * rows. Rows are native <details>/<summary>, so they open with no JS and are
 * keyboard and screen-reader accessible for free. The chips are toggle
 * buttons (aria-pressed); every group stays in the DOM and the inactive ones
 * are `hidden`, so switching never refetches or loses a row's open state.
 */

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqGroup {
  label: string;
  items: FaqItem[];
}

export interface FaqListProps {
  groups: FaqGroup[];
  /** Category shown first (default: the first group). */
  initial?: string;
  /** Open the first row of the first category, as the mock shows it. */
  openFirst?: boolean;
}

/** The rows a category shows. Unknown label: none. */
export function faqItemsFor(groups: FaqGroup[], label: string): FaqItem[] {
  return groups.find((g) => g.label === label)?.items ?? [];
}

export default function FaqList({
  groups,
  initial,
  openFirst = true,
}: FaqListProps): React.JSX.Element {
  const [active, setActive] = useState(initial ?? groups[0]?.label ?? "");
  const base = useId();

  return (
    <div className={styles.wrap}>
      <div className={styles.chips} role="group" aria-label="Show questions for">
        {groups.map((g) => {
          const on = g.label === active;
          return (
            <button
              key={g.label}
              type="button"
              className={[styles.chip, on ? styles.chipOn : ""].filter(Boolean).join(" ")}
              aria-pressed={on}
              aria-controls={`${base}-${g.label}`}
              onClick={() => setActive(g.label)}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {groups.map((g, gi) => (
        <section
          key={g.label}
          id={`${base}-${g.label}`}
          className={styles.card}
          hidden={g.label !== active}
          aria-label={`Questions for ${g.label.toLowerCase()}`}
          data-testid={`faq-group-${g.label}`}
        >
          {g.items.map((item, i) => (
            <details key={item.q} className={styles.item} open={openFirst && gi === 0 && i === 0}>
              <summary className={styles.q}>
                <h3 className={styles.qText}>{item.q}</h3>
                <span className={styles.toggle} aria-hidden="true" />
              </summary>
              <p className={styles.a}>{item.a}</p>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
