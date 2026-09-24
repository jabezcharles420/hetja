import type { Metadata } from "next";
import { Label, StatusIcon } from "@/components/ds";
import c from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "Privacy · Hetja",
  description:
    "What we keep and what we don't: as little as possible, and never a dog's exact location. Hashed email addresses, ward-level location, clear access tiers, and erasure rights under the DPDP Act.",
};

/* Pages 15: the mock's three rows. */
const SHORT = [
  {
    icon: "check" as const,
    title: "Ward only",
    text: "Dogs are placed by ward. No map pins, no street names.",
  },
  {
    icon: "check" as const,
    title: "Random codes",
    text: "You can't guess the next dog from this one.",
  },
  {
    icon: "cross" as const,
    title: "No ads, no tracking",
    text: "Your email is for sign-in codes. That is all it is for.",
  },
];

/* Kept from the previous page: the long version. */
const STORED_POINTS = [
  {
    title: "Your email address, hashed",
    text: "We never store your bare email address. We store a one-way hash (identity_hmac) built with a per-app secret, so your address can't be read back from our database.",
  },
  {
    title: "Your acts, as a log",
    text: "Feeds, SOS reports, and vet notes you make are logged against the dog's file and your account. These are what build your streak and trust score.",
  },
  {
    title: "Location, coarsened",
    text: "We only keep location at ward or cell level, the same grain as a neighbourhood. Exact coordinates are never stored, on any tier.",
  },
  {
    title: "The medical ledger",
    text: "Vet-signed records belong to the dog, not to any person. They are part of the public, tamper-evident history of that animal.",
  },
];

const GEO_TIERS = [
  {
    scope: "Ward",
    text: "Your feed is attached to the ward where the dog lives: enough to coordinate with other feeders, and nothing more.",
  },
  {
    scope: "Cell",
    text: "Coverage maps use anonymous cells (several hundred metres across) that combine many people's activity. No individual is visible in them.",
  },
  {
    scope: "Never exact",
    text: "No one, not even Hetja staff, can look up where you stood when you logged a feed.",
  },
];

const ACCESS_TIERS = [
  {
    name: "Everyone (public)",
    scope: "Read · dog profile",
    text: "The dog's name, ward, status, verified medical records, and micro-story are public. That's the point: the network works because anyone can look.",
  },
  {
    name: "Feeders",
    scope: "Read · their own log",
    text: "You can always see your own feed history, streaks, and trust score. Other feeders are shown only by first name and ward, never an email address.",
  },
  {
    name: "Vets",
    scope: "Write · medical ledger",
    text: "Identity-verified vets can add and sign medical records. Their entries are publicly attributed, because a signed ledger is what makes it trustworthy.",
  },
  {
    name: "BMC & NGOs",
    scope: "Read · aggregate coverage",
    text: "Authorities see aggregated, k-anonymized coverage data for ABC and vaccination planning. No personal information is included.",
  },
];

const RIGHTS = [
  {
    title: "Access",
    text: "Ask us and we'll show you exactly what we hold about you. It's usually just your hashed email address and your act log.",
  },
  {
    title: "Correction",
    text: "A wrong record about you can be corrected. On the dog's medical ledger, corrections are added as new signed records, never edits.",
  },
  {
    title: "Erasure",
    text: "Request deletion and we remove your personal data (your hashed email address, your act log, your feed history) within 30 days.",
  },
  {
    title: "Consent",
    text: "DPDP-aligned consent, versioned and recorded, is asked at sign-up. You can withdraw it the same way you gave it.",
  },
];

function Rows({ items }: { items: { title: string; text: string }[] }): React.JSX.Element {
  return (
    <ul className={c.darkList}>
      {items.map((it) => (
        <li key={it.title}>
          <h3 className={c.darkTitle}>{it.title}</h3>
          <p className={c.darkText}>{it.text}</p>
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPage(): React.JSX.Element {
  return (
    <div className={`${c.page} ${c.black}`}>
      <section className={`h-container ${c.headPlain}`} aria-labelledby="privacy-title">
        <div className={`${c.col} ${c.stack}`}>
          <h1 id="privacy-title" className={c.titleLg}>
            What we keep. What we don&apos;t.
          </h1>
          <p className={c.lead}>
            Short version: as little as possible, and never a dog&apos;s exact location.
          </p>
          <ul className={c.darkRows}>
            {SHORT.map((row) => (
              <li key={row.title} className={c.darkRow}>
                <StatusIcon
                  name={row.icon}
                  size={20}
                  className={`${c.darkIcon} ${row.icon === "check" ? c.iconOk : c.iconNo}`}
                />
                <div>
                  <h2 className={c.darkTitle}>{row.title}</h2>
                  <p className={c.darkText}>{row.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label tone="band">What we store</Label>
            <h2 className={c.h2}>Four things, and nothing more.</h2>
          </div>
          <Rows items={STORED_POINTS} />
        </div>
      </section>

      <section className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label tone="band">Location</Label>
            <h2 className={c.h2}>We know the street, never the spot.</h2>
            <p className={c.sub}>
              Coordination needs a neighbourhood. Privacy needs you to stay anonymous. We solve both
              by keeping every location coarse.
            </p>
          </div>
          <ul className={c.darkList}>
            {GEO_TIERS.map((tier) => (
              <li key={tier.scope}>
                <h3 className={c.darkTitle}>{tier.scope}</h3>
                <p className={c.darkText}>{tier.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label tone="band">Who sees what</Label>
            <h2 className={c.h2}>Access is a ladder, not a free-for-all.</h2>
            <p className={c.sub}>
              More responsibility means more access, and more of your identity on the line.
            </p>
          </div>
          <ul className={c.darkList}>
            {ACCESS_TIERS.map((tier) => (
              <li key={tier.name}>
                <h3 className={c.darkTitle}>{tier.name}</h3>
                <p className={c.darkScope}>{tier.scope}</p>
                <p className={c.darkText}>{tier.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label tone="band">Your rights</Label>
            <h2 className={c.h2}>DPDP-aligned, and yours to use.</h2>
          </div>
          <Rows items={RIGHTS} />
        </div>
      </section>

      <section className={`h-container ${c.section} ${c.sectionEnd}`}>
        <figure className={c.col}>
          <blockquote className={c.quote}>
            &ldquo;If you ever wonder what we hold about you, ask. You&rsquo;ll get an answer from a
            person, not a policy page.&rdquo;
          </blockquote>
          <figcaption className={c.cite}>
            Data requests:{" "}
            <a href="mailto:hello@hetja.in" className={c.link}>
              hello@hetja.in
            </a>
          </figcaption>
        </figure>
      </section>
    </div>
  );
}
