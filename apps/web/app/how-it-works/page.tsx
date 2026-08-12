import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PawIllustration from "@/components/PawIllustration";
import styles from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "How it works — Hetja",
  description:
    "Scan the collar, see the dog's profile, and act — feed, raise an SOS, or send a vet note. It works even with no signal.",
};

const STEPS = [
  {
    num: "1",
    title: "Scan the collar",
    text: "Point your camera at the QR code on a dog's collar, or type the 9-character code printed beneath it. That code is the dog's ID and the key to their whole file.",
    points: [
      "No app needed — any phone camera reads a QR.",
      "Works with zero signal: the profile you've seen before stays on your phone.",
      "Code never changes, so the dog keeps their file for life.",
    ],
  },
  {
    num: "2",
    title: "See the profile",
    text: "Meet the dog properly: their name, ward, ABC and vaccination status, verified medical records from the tamper-evident ledger, and a micro-story written by the people who feed them.",
    points: [
      "Medical records appear only when a verified vet has signed them.",
      "Location is shown at ward or cell level — never the dog's exact spot.",
      "Every record links back to the chain, so you know it hasn't been edited.",
    ],
  },
  {
    num: "3",
    title: "Act",
    text: "Log a feed so the dog's regular feeders know they're covered. Raise an SOS when something's wrong, and it fans out to nearby feeders and responders. Send a vet note when you've treated the dog.",
    points: [
      "Every act is logged against the dog's file.",
      "Feed logs build your trust score and your streak.",
      "SOS reports are visible to the whole network, so help actually arrives.",
    ],
  },
];

const OFFLINE_POINTS = [
  "Profile data is cached on your phone after the first scan.",
  "Feeds and SOS reports are queued safely on-device.",
  "Everything flushes automatically the moment you're back online.",
];

export default function HowItWorksPage(): React.JSX.Element {
  return (
    <>
      <PageHeader
        kicker="How it works"
        title="Scan. See. Act."
        intro="Three moves, and a dog on your street is a little safer. No account needed to look, no training needed to help — just the collar, the code, and a phone."
      />

      <section className={`${styles.section} h-container`}>
        <div className={styles.headCenter}>
          <span className="h-pill h-pill-amber">The three steps</span>
          <h2 className={styles.title2}>From street to shared, in under a minute.</h2>
          <p className={styles.sub}>
            Every step is designed to be done one-handed, at night, on a street corner.
          </p>
        </div>
        <div className={styles.grid3}>
          {STEPS.map((step) => (
            <article className={styles.step} key={step.num}>
              <div className={styles.stepTop}>
                <span className={styles.stepNum} aria-hidden="true">
                  {step.num}
                </span>
                <span className={styles.stepPaw}>
                  <PawIllustration size={30} />
                </span>
              </div>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepText}>{step.text}</p>
              <ul className={styles.stepList}>
                {step.points.map((point) => (
                  <li key={point}>
                    <span className={styles.stepBullet} aria-hidden="true">
                      · 
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.offline}>
          <div>
            <span className="h-pill h-pill-amber">The offline story</span>
            <h2 className={styles.offlineTitle}>No signal? No problem.</h2>
            <p className={styles.offlineText}>
              Mumbai&rsquo;s lanes don&rsquo;t always have a bar of data — and a dog
              that needs you doesn&rsquo;t care. Hetja was built for the patchy
              networks where street dogs actually live.
            </p>
            <Link
              className={`h-btn h-btn-primary ${styles.offlineCta}`}
              href="/scan"
            >
              Scan a collar
            </Link>
          </div>
          <ul className={styles.offlineList}>
            {OFFLINE_POINTS.map((point) => (
              <li key={point}>
                <span className={styles.offlineCheck} aria-hidden="true">
                  ✓
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="h-band">
        <div className="h-container h-band-inner">
          <h2 className="h-band-title">The collar is on. The dog is waiting.</h2>
          <p className="h-band-sub">
            Find out who&rsquo;s on your street, then come back for the daily feed.
          </p>
          <Link className="h-btn h-btn-primary" href="/scan">
            Scan a collar
          </Link>
        </div>
      </section>
    </>
  );
}
