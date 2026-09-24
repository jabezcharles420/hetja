import type { Metadata } from "next";
import Link from "next/link";
import { Aurora, Button, Label, SectionFade, StatusIcon } from "@/components/ds";
import c from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "About · Hetja",
  description:
    "Hetja is a coordination layer for the feeders, vets, NGOs, and BMC who already care for Mumbai's street dogs. Scan a collar, meet the dog, and act.",
};

/* Pages 12: the mock's three cards. */
const MISSION = [
  { title: "A memory", text: "Every dog has a profile that outlives any one feeder's phone." },
  { title: "A ledger", text: "Feeds and vet records, in order, with names attached." },
  { title: "A voice", text: "An SOS that reaches someone who can actually come." },
];

/* Kept from the previous About page: facts the mock does not cover. */
const COLLAR_STEPS = [
  {
    title: "Collar",
    text: "Every dog in the programme wears a weatherproof collar with a printed QR and a 9-character code.",
  },
  {
    title: "Scan",
    text: "Any phone reads it. No app needed for a single scan, no account required to look. It works with no signal at all.",
  },
  {
    title: "Act",
    text: "Feed, raise an SOS, or send a vet note. Every act is logged against the dog's file and credited to you.",
  },
];

const LEDGER_POINTS = [
  "Every medical record is hashed and chained to the one before it. Edit one, and the whole chain is visibly broken.",
  "Only identity-verified vets can add medical records, and each one is signed.",
  "A correction never deletes the past. It adds a new, clearly labelled record.",
  "You don't have to take our word for it. The chain is verifiable, and the 'verified' badge only appears on records that pass.",
];

const PHASES = [
  {
    tag: "Phase 0",
    title: "The pilot",
    dogs: "~50 dogs, one ward",
    text: "A handful of dogs, trusted feeders, and one partner vet clinic. We prove the whole loop (collar, scan, feed, record) before anything scales.",
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

export default function AboutPage(): React.JSX.Element {
  return (
    <div className={`${c.page} ${c.mist}`}>
      <Aurora variant="about" className={c.head}>
        <div className="h-container">
          <div className={`${c.col} ${c.stack}`}>
            <p className={c.kickerPill}>Our mission</p>
            <h1 className={c.title}>A coordination layer for people who already care.</h1>
            <p className={c.lead}>
              Hetja is not another app asking you to care about stray dogs. The people who care (the
              feeders, vets, NGOs, and municipal staff) are already out there. We just give their
              care a memory, a ledger, and a voice.
            </p>
          </div>
        </div>
      </Aurora>

      <section className={`h-container ${c.missionCards}`} aria-label="What Hetja gives them">
        <ul className={`${c.col} ${c.miniList}`}>
          {MISSION.map((m) => (
            <li key={m.title} className={c.miniCard}>
              <h2 className={c.miniTitle}>{m.title}</h2>
              <p className={c.miniText}>{m.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label>What Hetja is</Label>
            <h2 className={c.h2}>Mumbai already loves its strays. Hetja keeps track of that love.</h2>
          </div>
          <div className={c.prose}>
            <p>
              A street dog in Mumbai is fed by whoever happens to pass, treated by whichever vet has
              time, and remembered only by the people who see it daily. When a dog falls sick, no
              one knows. When a new feeder arrives, they start from zero. When BMC plans an ABC
              drive, it works on guesses.
            </p>
            <p>
              Hetja gives every collar-wearing dog a public profile: a name, a ward, verified
              medical records, and a running log of who shows up for it. Suddenly a whole
              street&rsquo;s care becomes one shared, honest picture.
            </p>
            <p>
              We are <strong>not</strong> a replacement for the people doing this. We are the
              thread that ties them together.
            </p>
            <figure className={c.card}>
              <blockquote className={c.quote}>
                &ldquo;The feeders, vets, and neighbours who show up for street dogs are the
                product. Hetja is just the thread that ties them together.&rdquo;
              </blockquote>
              <figcaption className={c.cite}>The idea behind Hetja</figcaption>
            </figure>
          </div>
        </div>
      </SectionFade>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.sectionHead}>
          <Label>How the collar works</Label>
          <h2 className={c.h2}>A QR collar is a dog&rsquo;s whole file.</h2>
          <p className={c.sub}>
            One scan and the animal&rsquo;s story (medical, social, and practical) is in your hands.
          </p>
        </div>
        <ul className={`${c.cards} ${c.cards3}`}>
          {COLLAR_STEPS.map((step) => (
            <li key={step.title} className={c.card}>
              <h3 className={c.cardTitle}>{step.title}</h3>
              <p className={c.cardText}>{step.text}</p>
            </li>
          ))}
        </ul>
      </SectionFade>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label>The ledger</Label>
            <h2 className={c.h2}>A medical record that can&rsquo;t be quietly edited.</h2>
            <p className={c.sub}>
              Trust is the whole product. So the ledger is built to be tamper-evident by design, not
              by promise.
            </p>
          </div>
          <div className={c.card}>
            <ul className={c.checks}>
              {LEDGER_POINTS.map((point) => (
                <li key={point}>
                  <StatusIcon name="check" size={16} className={c.check} />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionFade>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.sectionHead}>
          <Label>The rollout</Label>
          <h2 className={c.h2}>Built street by street, not all at once.</h2>
          <p className={c.sub}>
            We&rsquo;d rather do one ward beautifully than a city carelessly. Each phase proves
            itself before the next begins.
          </p>
        </div>
        <ul className={c.cards}>
          {PHASES.map((phase) => (
            <li key={phase.tag} className={c.card}>
              <Label>{phase.tag}</Label>
              <h3 className={c.cardTitle}>{phase.title}</h3>
              <p className={c.cardMeta}>{phase.dogs}</p>
              <p className={c.cardText}>{phase.text}</p>
            </li>
          ))}
        </ul>
      </SectionFade>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.sectionHead}>
          <Label>Who it&rsquo;s for</Label>
          <h2 className={c.h2}>Everyone who already shows up.</h2>
          <p className={c.sub}>
            If you&rsquo;ve ever fed, treated, rescued, or planned for a street dog, this network is
            built around you.
          </p>
        </div>
        <ul className={c.cards}>
          {ROLES.map((role) => (
            <li key={role.title} className={c.card}>
              <h3 className={c.cardTitle}>{role.title}</h3>
              <p className={c.cardText}>{role.text}</p>
            </li>
          ))}
        </ul>
        <p className={`${c.sub} ${c.col} ${c.note}`}>
          This network exists because of one dog who did not survive a city like the one we&rsquo;re
          trying to build.{" "}
          <Link href="/hetja" className={c.link}>
            Read why we built Hetja.
          </Link>
        </p>
      </SectionFade>

      <section className={`h-container ${c.cta}`}>
        <div className={c.ctaInner}>
          <h2 className={c.ctaTitle}>Meet the dog on your street.</h2>
          <p className={c.sub}>
            See exactly how scanning, feeding, and acting fit together. It takes about a minute.
          </p>
          <Button href="/how-it-works">See how it works</Button>
        </div>
      </section>
    </div>
  );
}
