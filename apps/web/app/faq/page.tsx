import type { Metadata } from "next";
import { Aurora } from "@/components/ds";
import FaqList from "@/components/FaqList";
import { FAQ_GROUPS } from "./questions";
import c from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "FAQ · Hetja",
  description:
    "Answers for feeders, vets, NGOs, and citizens: feeding a dog that isn't yours, missing collars, streaks, verifying records, ABC integration, and reporting SOS.",
};

export default function FaqPage(): React.JSX.Element {
  return (
    <div className={`${c.page} ${c.mist}`}>
      <Aurora variant="faq" className={c.headFaq}>
        <div className="h-container">
          <div className={`${c.col} ${c.stack}`}>
            <h1 className={c.title}>Questions from the street.</h1>
            <p className={`${c.lead} ${c.leadPlain}`}>
              Everything feeders, vets, NGOs, and citizens ask us most. If your question isn&apos;t
              here, write to{" "}
              <a href="mailto:hello@hetja.in" className={c.link}>
                hello@hetja.in
              </a>{" "}
              and a person will answer.
            </p>
          </div>
        </div>
      </Aurora>
      <section className={`h-container ${c.faqBody}`} aria-label="Questions">
        <div className={c.col}>
          <FaqList groups={FAQ_GROUPS} />
        </div>
      </section>
    </div>
  );
}
