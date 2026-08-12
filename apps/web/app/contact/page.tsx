import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";
import PawIllustration from "@/components/PawIllustration";
import styles from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "Contact — Hetja",
  description:
    "Reach the Hetja team at hello@hetja.in. NGOs, vets, and BMC — let's talk about rolling the collar programme out to your territory.",
};

const PARTNER_POINTS = [
  "NGOs & shelters — collar deployment and ABC drive data for your territory.",
  "Vets — clinic onboarding, ledger access, and verification flows.",
  "BMC & authorities — honest, ward-level coverage data for planning.",
];

export default function ContactPage(): React.JSX.Element {
  return (
    <>
      <PageHeader
        kicker="Contact"
        title="Talk to a human."
        intro="No ticket system, no chatbots. If you have a question, a correction, a data request, or an idea — write to us and a person who actually works on Hetja will reply."
      />

      <section className={`${styles.section} h-container`}>
        <div className={styles.split}>
          <div className={styles.contactCard}>
            <span className={styles.contactLabel}>Write to us</span>
            <a className={styles.contactEmail} href="mailto:hello@hetja.in">
              hello@hetja.in
            </a>
            <p className={styles.contactNote}>
              For questions, damaged-collar reports, data requests, and anything
              else. We read everything and reply within a couple of days.
            </p>
            <div className={styles.contactPaw}>
              <PawIllustration size={32} className={styles.offlineIcon} />
            </div>
          </div>

          <div className={styles.prose}>
            <span className="h-pill h-pill-amber">Partnerships</span>
            <h2 className={styles.title2}>Let&rsquo;s cover more streets together.</h2>
            <p>
              Hetja works because the people who already run this city&rsquo;s
              animal welfare plug into it. If you&rsquo;re an NGO, a vet clinic, or
              a BMC department, the collar programme is built to be adopted, not
              reinvented.
            </p>
            <ul>
              {PARTNER_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p>
              Tell us your ward, your numbers, and what you&rsquo;d want to see on a
              dashboard. We&rsquo;ll take it from there.
            </p>
          </div>
        </div>
      </section>

      <section className={`${styles.section} h-container`}>
        <div className={styles.partnerCard}>
          <h3 className={styles.partnerCardTitle}>Looking for the vet or feeder line?</h3>
          <p className={styles.cardText}>
            The fastest way to reach a real vet near a specific dog is the SOS button
            on that dog&rsquo;s profile — it alerts the ward&rsquo;s responders directly.
            For clinic partnerships, onboarding, or coverage dashboards, use the address
            above with &ldquo;partnerships&rdquo; in the subject.
          </p>
        </div>
      </section>
    </>
  );
}
