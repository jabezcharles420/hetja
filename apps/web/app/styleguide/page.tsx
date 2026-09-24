import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoreSection } from "./CoreSection";
import { IosSection } from "./IosSection";
import { MotionSection } from "./MotionSection";

/**
 * Living styleguide for the v3 (Apple/Sidehoe) design system. Every token and
 * every components/ui element renders here so the look can be signed off in
 * one place. Dev-only: 404s in production builds, never linked from the nav.
 */
export const metadata: Metadata = {
  title: "Styleguide · Hetja",
  robots: { index: false, follow: false },
};

export default function StyleguidePage(): React.JSX.Element {
  if (process.env.NODE_ENV === "production" && process.env.HETJA_STYLEGUIDE !== "1") {
    notFound();
  }
  return (
    <>
      <section className="h-section h-section-center">
        <div className="h-container">
          <span className="h-chip">Design system v3</span>
          <h1 className="h-headline" style={{ marginTop: 22 }}>
            Hetja styleguide.
          </h1>
          <p className="h-lede">
            Tokens, primitives and every Apple-style element, <strong>in one place.</strong>
          </p>
        </div>
      </section>
      <CoreSection />
      <IosSection />
      <MotionSection />
    </>
  );
}
