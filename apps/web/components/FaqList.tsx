"use client";

import { useState } from "react";
import PawIllustration from "./PawIllustration";
import styles from "./FaqList.module.css";

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqGroup {
  label: string;
  items: FaqItem[];
}

interface FaqAccordionItemProps {
  item: FaqItem;
  id: string;
}

function FaqAccordionItem({ item, id }: FaqAccordionItemProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <li className={styles.item}>
      <h3 className={styles.questionWrap}>
        <button
          type="button"
          className={styles.question}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={id}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{item.q}</span>
          <span className={styles.toggle} aria-hidden="true">
            {open ? "\u2212" : "+"}
          </span>
        </button>
      </h3>
      {open ? (
        <div
          className={styles.answer}
          id={`${id}-panel`}
          role="region"
          aria-labelledby={id}
        >
          <p>{item.a}</p>
        </div>
      ) : null}
    </li>
  );
}

export interface FaqListProps {
  groups: FaqGroup[];
}

export default function FaqList({ groups }: FaqListProps): React.JSX.Element {
  return (
    <div className={styles.list}>
      {groups.map((group, gi) => (
        <section
          key={group.label}
          className={styles.group}
          aria-labelledby={`faq-group-${gi}`}
        >
          <h2 className={styles.groupTitle} id={`faq-group-${gi}`}>
            <span className={styles.groupIcon}>
              <PawIllustration size={22} />
            </span>
            {group.label}
          </h2>
          <ul className={styles.items}>
            {group.items.map((item, ii) => (
              <FaqAccordionItem key={item.q} item={item} id={`faq-${gi}-${ii}`} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
