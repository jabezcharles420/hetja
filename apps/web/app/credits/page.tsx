import Link from "next/link";
import { LogoMark } from "@/components/ds";
import { AppHeader } from "@/components/ds/AppHeader";
import { shownGroups } from "@/lib/credits";
import styles from "./credits.module.css";

/**
 * Credits (design v8, the design system's ui_kits/credits, 390): a thank-you
 * page for the people and groups who helped. A focused screen with "‹ About".
 * The names live in lib/credits.ts.
 */
export const metadata = { title: "Thank you · Hetja" };

export default function CreditsPage(): React.JSX.Element {
  const groups = shownGroups();
  return (
    <div className={styles.page}>
      <AppHeader back={{ href: "/about", label: "About", history: true }} surface="mist" />
      <div className={styles.body}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Thank you.</h1>
          <p className={styles.lead}>
            Hetja was built by a few people and kept alive by many more. Most of them never wrote a line of code.
            They just kept showing up.
          </p>
        </div>

        <Link href="/hetja" className={styles.memorial}>
          <span className={styles.mark}>
            <LogoMark size={36} />
          </span>
          <span className={styles.memText}>
            <span className={styles.memName}>Hetja</span>
            <span className={styles.memSub}>Who walked three kilometres in the rain. This is for her.</span>
          </span>
          <span className={styles.chev} aria-hidden="true">
            ›
          </span>
        </Link>

        {groups.map((g) => (
          <section key={g.heading} className={styles.group}>
            <h2 className={styles.label}>{g.heading}</h2>
            <ul className={styles.list}>
              {g.people.map((p, i) => (
                <li key={`${p.name}-${i}`} className={styles.row}>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.did}>{p.did}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className={styles.ask}>
          Helped and not on this page? Write to <a href="mailto:hello@hetja.in">hello@hetja.in</a> and a person will
          put you here.
        </p>
        <p className={styles.foot}>Free, open source, built in Mumbai.</p>
      </div>
    </div>
  );
}
