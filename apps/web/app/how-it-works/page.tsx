import type { Metadata } from "next";
import { Button, Label, SectionFade, StatusIcon } from "@/components/ds";
import c from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "How it works · Hetja",
  description:
    "From collar to vet, in order: a feeder registers the dog, feeders log each meal, vets add records, and anyone can raise an SOS.",
};

/* Pages 13. Rows 2 and 3 carry the #feeders / #vets anchors the desktop
 * nav links to. */
const ROWS = [
  {
    id: undefined,
    title: "A feeder registers the dog",
    text: "Name, photo, ward. Hetja prints a collar tag with a random code.",
  },
  {
    id: "feeders",
    title: "Feeders log each meal",
    text: "Scan, tap, done. The profile shows when the dog last ate.",
  },
  {
    id: "vets",
    title: "Vets add records",
    text: "Shots, sterilisation, treatment. Locked once saved.",
  },
  {
    id: undefined,
    title: "Anyone can raise an SOS",
    text: "It goes to the dog's feeders and the nearest vet on Hetja.",
  },
];

/* Kept from the previous page: the detail behind each step. */
const STEPS = [
  {
    title: "Scan the collar",
    text: "Point your camera at the QR code on a dog's collar, or type the 9-character code printed beneath it. That code is the dog's ID and the key to their whole file.",
    points: [
      "No app needed. Any phone camera reads a QR.",
      "Works with zero signal: the profile you've seen before stays on your phone.",
      "Code never changes, so the dog keeps their file for life.",
    ],
  },
  {
    title: "See the profile",
    text: "Meet the dog properly: their name, ward, ABC and vaccination status, verified medical records from the tamper-evident ledger, and a micro-story written by the people who feed them.",
    points: [
      "Medical records appear only when a verified vet has signed them.",
      "Location is shown at ward or cell level, never the dog's exact spot.",
      "Every record links back to the chain, so you know it hasn't been edited.",
    ],
  },
  {
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
    <div className={`${c.page} ${c.white}`}>
      <section className={`h-container ${c.headPlain}`} aria-labelledby="how-title">
        <div className={`${c.col} ${c.stack14}`}>
          <h1 id="how-title" className={c.title}>
            From collar to vet, in order.
          </h1>
          <ol className={c.rows}>
            {ROWS.map((row, i) => (
              <li key={row.title} id={row.id} className={c.row}>
                <div className={c.rowNum} aria-hidden="true">
                  {i + 1}
                </div>
                <div>
                  <h2 className={c.rowTitle}>{row.title}</h2>
                  <p className={c.rowText}>{row.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.sectionHead}>
          <Label>The three steps</Label>
          <h2 className={c.h2}>From street to shared, in under a minute.</h2>
          <p className={c.sub}>
            Every step is designed to be done one-handed, at night, on a street corner.
          </p>
        </div>
        <ol className={`${c.cards} ${c.cards3}`}>
          {STEPS.map((step) => (
            <li key={step.title} className={c.card}>
              <h3 className={c.cardTitle}>{step.title}</h3>
              <p className={c.cardText}>{step.text}</p>
              <ul className={c.points}>
                {step.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </SectionFade>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label>The offline story</Label>
            <h2 className={c.h2}>No signal? No problem.</h2>
            <p className={c.sub}>
              Mumbai&rsquo;s lanes don&rsquo;t always have a bar of data, and a dog that needs you
              doesn&rsquo;t care. Hetja was built for the patchy networks where street dogs actually
              live.
            </p>
          </div>
          <div className={c.card}>
            <ul className={c.checks}>
              {OFFLINE_POINTS.map((point) => (
                <li key={point}>
                  <StatusIcon name="check" size={16} className={c.check} />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionFade>

      <section className={`h-container ${c.cta}`}>
        <div className={c.ctaInner}>
          <h2 className={c.ctaTitle}>The collar is on. The dog is waiting.</h2>
          <p className={c.sub}>Find out who&rsquo;s on your street, then come back for the daily feed.</p>
          <Button href="/scan">Scan a collar</Button>
        </div>
      </section>
    </div>
  );
}
