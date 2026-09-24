import type { Metadata } from "next";
import { Aurora, Label, SectionFade } from "@/components/ds";
import c from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "Contact · Hetja",
  description:
    "Write to a person at hello@hetja.in. NGOs, vets, and BMC: let's talk about rolling the collar programme out to your territory.",
};

/* Kept from the previous page: partnerships. */
const PARTNER_POINTS = [
  "NGOs & shelters: collar deployment and ABC drive data for your territory.",
  "Vets: clinic onboarding, ledger access, and verification flows.",
  "BMC & authorities: honest, ward-level coverage data for planning.",
];

export default function ContactPage(): React.JSX.Element {
  return (
    <div className={`${c.page} ${c.base}`}>
      <Aurora variant="contact" className={c.headContact}>
        <div className="h-container">
          <div className={`${c.col} ${c.stack14}`}>
            <h1 className={c.title}>Write to a person.</h1>
            <a className={c.email} href="mailto:hello@hetja.in">
              hello@hetja.in
            </a>
            <p className={c.body17}>
              We read everything. Replies take a day or two, longer in monsoon.
            </p>
            <div className={c.callout} role="note">
              <span className={c.bang} aria-hidden="true">
                !
              </span>
              <p className={c.calloutText}>
                For a dog in trouble, don&apos;t email. Scan its collar and press{" "}
                <b>This dog needs help</b>.
              </p>
            </div>
          </div>
        </div>
      </Aurora>

      <SectionFade as="section" className={`h-container ${c.section}`}>
        <div className={c.col}>
          <div className={c.sectionHead}>
            <Label>Partnerships</Label>
            <h2 className={c.h2}>Let&rsquo;s cover more streets together.</h2>
          </div>
          <div className={c.card}>
            <div className={c.prose}>
              <p className={c.cardText}>
                Hetja works because the people who already run this city&rsquo;s animal welfare plug
                into it. If you&rsquo;re an NGO, a vet clinic, or a BMC department, the collar
                programme is built to be adopted, not reinvented.
              </p>
              <ul className={c.points}>
                {PARTNER_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <p className={c.cardText}>
                Tell us your ward, your numbers, and what you&rsquo;d want to see on a dashboard.
                We&rsquo;ll take it from there.
              </p>
            </div>
          </div>
        </div>
      </SectionFade>

      <section className={`h-container ${c.sectionTight} ${c.sectionEnd}`}>
        <div className={`${c.col} ${c.card}`}>
          <h2 className={c.cardTitle}>Looking for the vet or feeder line?</h2>
          <p className={c.cardText}>
            The fastest way to reach a real vet near a specific dog is the SOS button on that
            dog&rsquo;s profile. It alerts the ward&rsquo;s responders directly. For clinic
            partnerships, onboarding, or coverage dashboards, use the address above with
            &ldquo;partnerships&rdquo; in the subject.
          </p>
        </div>
      </section>
    </div>
  );
}
