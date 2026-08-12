import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PawIllustration from "@/components/PawIllustration";
import styles from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "About — Hetja",
  description:
    "Hetja is a coordination layer for the feeders, vets, NGOs, and BMC who already care for Mumbai's street dogs. Scan a collar, meet the dog, and act.",
};

const PHASES = [
  {
    tag: "Phase 0",
    title: "The pilot",
    dogs: "~50 dogs, one ward",
    text: "A handful of dogs, trusted feeders, and one partner vet clinic. We prove the whole loop — collar, scan, feed, record — before anything scales.",
  },
  {
    tag: "Phase 1",
    title: "A few wards",
    dogs: "1,000 dogs",
    text: "The feeder network widens and a first NGO plugs in. Vets begin signing records into the ledger. We learn what the streets teach us.",
  },
  {
    tag: "Phase 2",
    title: "One BMC zone",
    dogs: "10,000 dogs",
    text: "An entire zone covered. ABC units and BMC health staff read live coverage data, and every ward's dogs start to be counted honestly.",
  },
  {
    tag: "Phase 3",
    title: "The whole state",
    dogs: "100,000 dogs",
    text: "Maharashtra's strays. Open to every citizen and every authority, from the neighbourhood feeder to the municipal planner.",
  },
];

const ROLES = [
  {
    title: "Feeders",
    text: "The daily bowl is the heart of this network. Log feeds, keep streaks, and build a trust score your ward can rely on.",
  },
  {
    title: "Vets",
    text: "Verify and sign records into the tamper-evident ledger, so a dog's medical story is something everyone can trust.",
  },
  {
    title: "NGOs & shelters",
    text: "Run ABC drives and shelter intakes with live coverage data. Adopt the collar programme for the territory you already protect.",
  },
  {
    title: "BMC & authorities",
    text: "Plan ABC and vaccination drives with honest, ward-level numbers instead of guesses. The same data, publicly accountable.",
  },
];

const COLLAR_STEPS = [
  {
    title: "Collar",
    text: "Every dog in the programme wears a weatherproof collar with a printed QR and a 9-character code.",
  },
  {
    title: "Scan",
    text: "Any phone reads it — no app needed for a single scan, no account required to look. It works with no signal at all.",
  },
  {
    title: "Act",
    text: "Feed, raise an SOS, or send a vet note. Every act is logged against the dog's file and credited to you.",
  },
];

const LEDGER_POINTS = [
  "Every medical record is hashed and chained to the one before it — edit one, and the whole chain is visibly broken.",
  "Only identity-verified vets can add medical records, and each one is signed.",
  "A correction never deletes the past — it adds a new, clearly labelled record.",
  "You don't have to take our word for it. The chain is verifiable, and the 'verified' badge only appears on records that pass.",
];

export default function AboutPage(): React.JSX.Element {
  return (
    <>
      <PageHeader
        kicker="Our mission"
        title="A coordination layer for people who already care."
        intro="Hetja is not another app asking you to care about stray dogs. The people who care — the feeders, vets, NGOs, and municipal staff — are already out there. We just give their care a memory, a ledger, and a voice."
      />

      <section className={`${styles.section} h-container`}>
        <div className={styles.split}>
          <div className={styles.prose}>
            <span className="h-pill h-pill-amber">What Hetja is</span>
            <h2 className={styles.title2}>Mumbai already loves its strays. Hetja keeps track of that love.</h2>
            <p>
              A street dog in Mumbai is fed by whoever happens to pass, treated by
              whichever vet has time, and remembered only by the people who see it
              daily. When a dog falls sick, no one knows. When a new feeder arrives,
              they start from zero. When BMC plans an ABC drive, it works on guesses.
            </p>
            <p>
              Hetja gives every collar-wearing dog a public profile — a name, a ward,
              verified medical records, and a running log of who shows up for it.
              Suddenly a whole street&rsquo;s care becomes one shared, honest picture.
            </p>
            <p>
              We are <strong>not</strong> a replacement for the people doing this.
              We are the thread that ties them together.
            </p>
          </div>
          <aside className={styles.forestQuote}>
            <PawIllustration size={44} className={styles.forestQuotePaw} />
            <p className={styles.quote}>
              &ldquo;The feeders, vets, and neighbours who show up for street dogs
              are the product. Hetja is just the thread that ties them together.&rdquo;
            </p>
            <span className={styles.quoteCite}>The idea behind Hetja</span>
          </aside>
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.headCenter}>
          <span className="h-pill h-pill-amber">How the collar works</span>
          <h2 className={styles.title2}>A QR collar is a dog&rsquo;s whole file.</h2>
          <p className={styles.sub}>
            One scan and the animal&rsquo;s story — medical, social, and practical —
            is in your hands.
          </p>
        </div>
        <div className={styles.grid3}>
          {COLLAR_STEPS.map((step) => (
            <article className={styles.card} key={step.title}>
              <span className={styles.iconCircle}>
                <PawIllustration size={26} />
              </span>
              <h3 className={styles.cardTitle}>{step.title}</h3>
              <p className={styles.cardText}>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <span className="h-pill h-pill-amber">The ledger</span>
          <h2 className={styles.title2}>A medical record that can&rsquo;t be quietly edited.</h2>
          <p className={styles.sub}>
            Trust is the whole product. So the ledger is built to be tamper-evident
            by design — not by promise.
          </p>
        </div>
        <article className={styles.card}>
          <ul className={styles.list}>
            {LEDGER_POINTS.map((point) => (
              <li key={point}>
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <span className="h-pill h-pill-amber">The rollout</span>
          <h2 className={styles.title2}>Built street by street, not all at once.</h2>
          <p className={styles.sub}>
            We&rsquo;d rather do one ward beautifully than a city carelessly. Each
            phase proves itself before the next begins.
          </p>
        </div>
        <div className={styles.grid4}>
          {PHASES.map((phase) => (
            <article className={styles.phase} key={phase.tag}>
              <span className={styles.phaseTag}>{phase.tag}</span>
              <h3 className={styles.phaseTitle}>{phase.title}</h3>
              <p className={styles.phaseDogs}>{phase.dogs}</p>
              <p className={styles.phaseText}>{phase.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <span className="h-pill h-pill-amber">Who it&rsquo;s for</span>
          <h2 className={styles.title2}>Everyone who already shows up.</h2>
          <p className={styles.sub}>
            If you&rsquo;ve ever fed, treated, rescued, or planned for a street dog,
            this network is built around you.
          </p>
        </div>
        <div className={styles.grid2}>
          {ROLES.map((role) => (
            <article className={styles.card} key={role.title}>
              <span className={styles.iconCircle}>
                <PawIllustration size={26} />
              </span>
              <h3 className={styles.cardTitle}>{role.title}</h3>
              <p className={styles.cardText}>{role.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <p className={styles.sub}>
            This network exists because of one dog who did not survive a city
            like the one we&rsquo;re trying to build.{" "}
            <Link href="/hetja">Read why we built Hetja.</Link>
          </p>
        </div>
      </section>

      <section className="h-band">
        <div className="h-container h-band-inner">
          <h2 className="h-band-title">Meet the dog on your street.</h2>
          <p className="h-band-sub">
            See exactly how scanning, feeding, and acting fit together — it takes
            about a minute.
          </p>
          <Link className="h-btn h-btn-primary" href="/how-it-works">
            See how it works
          </Link>
        </div>
      </section>
    </>
  );
}
