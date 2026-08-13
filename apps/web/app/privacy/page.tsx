import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";
import styles from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "Privacy — Hetja",
  description:
    "How Hetja handles your data under the Digital Personal Data Protection Act: hashed email addresses, coarsened location, clear access tiers, and erasure rights.",
};

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
    text: "We only keep location at ward or cell level — the same grain as a neighbourhood. Exact coordinates are never stored, on any tier.",
  },
  {
    title: "The medical ledger",
    text: "Vet-signed records belong to the dog, not to any person. They are part of the public, tamper-evident history of that animal.",
  },
];

const GEO_TIERS = [
  {
    scope: "Ward",
    text: "Your feed is attached to the ward where the dog lives — enough to coordinate with other feeders, and nothing more.",
  },
  {
    scope: "Cell",
    text: "Coverage maps use anonymous cells (several hundred metres across) that combine many people's activity. No individual is visible in them.",
  },
  {
    scope: "Never exact",
    text: "No one — not even Hetja staff — can look up where you stood when you logged a feed.",
  },
];

const ACCESS_TIERS = [
  {
    name: "Everyone (public)",
    scope: "Read · dog profile",
    pill: styles.tierScopeMint,
    text: "The dog's name, ward, status, verified medical records, and micro-story are public. That's the point — the network works because anyone can look.",
  },
  {
    name: "Feeders",
    scope: "Read · their own log",
    pill: styles.tierScopeCoral,
    text: "You can always see your own feed history, streaks, and trust score. Other feeders are shown only by first name and ward — never an email address.",
  },
  {
    name: "Vets",
    scope: "Write · medical ledger",
    pill: styles.tierScopeMoss,
    text: "Identity-verified vets can add and sign medical records. Their entries are publicly attributed, because a signed ledger is what makes it trustworthy.",
  },
  {
    name: "BMC & NGOs",
    scope: "Read · aggregate coverage",
    pill: styles.tierScopeMint,
    text: "Authorities see aggregated, k-anonymized coverage data for ABC and vaccination planning. No personal information is included.",
  },
];

const RIGHTS = [
  {
    title: "Access",
    text: "Ask us and we'll show you exactly what we hold about you — it's usually just your hashed email address and your act log.",
  },
  {
    title: "Correction",
    text: "A wrong record about you can be corrected. On the dog's medical ledger, corrections are added as new signed records, never edits.",
  },
  {
    title: "Erasure",
    text: "Request deletion and we remove your personal data — your hashed email address, your act log, your feed history — within 30 days.",
  },
  {
    title: "Consent",
    text: "DPDP-aligned consent, versioned and recorded, is asked at sign-up. You can withdraw it the same way you gave it.",
  },
];

export default function PrivacyPage(): React.JSX.Element {
  return (
    <>
      <PageHeader
        kicker="Privacy"
        title="Honest about what we hold."
        intro="Hetja only works if you trust it. So here's the plain-language version of what we store, how location is coarsened, who sees what, and how you take it back."
      />

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <span className="h-pill h-pill-amber">What we store</span>
          <h2 className={styles.title2}>Four things, and nothing more.</h2>
        </div>
        <div className={styles.grid2}>
          {STORED_POINTS.map((point) => (
            <article className={styles.card} key={point.title}>
              <h3 className={styles.cardTitle}>{point.title}</h3>
              <p className={styles.cardText}>{point.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <span className="h-pill h-pill-amber">Location</span>
          <h2 className={styles.title2}>We know the street, never the spot.</h2>
          <p className={styles.sub}>
            Coordination needs a neighbourhood. Privacy needs you to stay anonymous.
            We solve both by keeping every location coarse.
          </p>
        </div>
        <div className={styles.grid3}>
          {GEO_TIERS.map((tier) => (
            <article className={styles.tier} key={tier.scope}>
              <span className={styles.tierScope}>{tier.scope}</span>
              <p className={styles.tierText}>{tier.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <span className="h-pill h-pill-amber">Who sees what</span>
          <h2 className={styles.title2}>Access is a ladder, not a free-for-all.</h2>
          <p className={styles.sub}>
            More responsibility means more access — and more of your identity on the line.
          </p>
        </div>
        <div className={styles.grid2}>
          {ACCESS_TIERS.map((tier) => (
            <article className={styles.tier} key={tier.name}>
              <h3 className={styles.tierName}>{tier.name}</h3>
              <span className={`${styles.tierScope} ${tier.pill}`}>{tier.scope}</span>
              <p className={styles.tierText}>{tier.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.head}>
          <span className="h-pill h-pill-amber">Your rights</span>
          <h2 className={styles.title2}>DPDP-aligned, and yours to use.</h2>
        </div>
        <div className={styles.grid2}>
          {RIGHTS.map((right) => (
            <article className={styles.card} key={right.title}>
              <h3 className={styles.cardTitle}>{right.title}</h3>
              <p className={styles.cardText}>{right.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.forestQuote}>
          <p className={styles.quote}>
            &ldquo;If you ever wonder what we hold about you, ask. You&rsquo;ll get
            an answer from a person, not a policy page.&rdquo;
          </p>
          <span className={styles.quoteCite}>Data requests: hello@hetja.in</span>
        </div>
      </section>
    </>
  );
}
