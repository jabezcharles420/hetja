import type { Metadata } from "next";
import { Aurora, Button, Label, SectionFade, StatusIcon } from "@/components/ds";
import c from "@/components/Content.module.css";

export const metadata: Metadata = {
  title: "Feeders and vets · Hetja",
  description:
    "Feeders keep the daily bowl, vets sign the records, NGOs run the drives. What each does on Hetja, and how to start.",
};

/*
 * Design v8 (docs/design/v8-desktop): the Stitch nav's "Vets & Feeders" page,
 * in the design system. One section per role, each ending in the role's real
 * next step: /welcome, /vet/apply, /ngo/register. Those are phone flows, so on
 * a desktop the button opens the "Hetja lives on your phone" invitation with a
 * QR of that step. The desktop nav's Feeders and Vets link to #feeders and
 * #vets here.
 */
const ROLES = [
  {
    id: "feeders",
    label: "Feeders",
    title: "The daily bowl is the heart of this network.",
    text: "You probably already feed someone. Scan the collar, tap once, and the dog's page says they've eaten, so nobody gets double dinner and nobody gets none.",
    points: [
      "Log a feed in two taps, even with no signal: it sends itself later.",
      "Keep a streak, and build a trust score your ward can rely on.",
      "Get told when a dog you feed needs help, and only in the wards you pick.",
    ],
    cta: { href: "/welcome", label: "Start feeding" },
  },
  {
    id: "vets",
    label: "Vets",
    title: "Sign the record once, and it stays true.",
    text: "Verify and sign records into the tamper-evident ledger, so a dog's medical story is something everyone can trust.",
    points: [
      "Shots, sterilisation and treatment, signed with your passkey.",
      "Medical records can't be edited or deleted. Corrections go on top, with a name and a date.",
      "See the dogs near you whose vaccinations are due.",
    ],
    cta: { href: "/vet/apply", label: "Sign records as a vet" },
  },
  {
    id: "ngos",
    label: "NGOs and shelters",
    title: "Run the drives with real numbers.",
    text: "Run ABC drives and shelter intakes with live coverage data. Adopt the collar programme for the territory you already protect.",
    points: [
      "An SOS in your wards reaches your coordinators first.",
      "Dispatch a member, with or without the ambulance.",
      "Ward-level coverage, never a dog's exact spot.",
    ],
    cta: { href: "/ngo/register", label: "Bring your NGO to Hetja" },
  },
];

export default function JoinPage(): React.JSX.Element {
  return (
    <div className={`${c.page} ${c.mist}`}>
      <Aurora variant="about" className={c.head}>
        <div className="h-container">
          <div className={`${c.col} ${c.stack}`}>
            <p className={c.kickerPill}>Feeders and vets</p>
            <h1 className={c.title}>Everyone who already shows up.</h1>
            <p className={c.lead}>
              If you&rsquo;ve ever fed, treated, rescued, or planned for a street dog, this network is built around you.
            </p>
          </div>
        </div>
      </Aurora>

      {ROLES.map((r) => (
        <SectionFade key={r.id} as="section" className={`h-container ${c.section}`}>
          <div className={c.col} id={r.id}>
            <div className={c.sectionHead}>
              <Label>{r.label}</Label>
              <h2 className={c.h2}>{r.title}</h2>
              <p className={c.sub}>{r.text}</p>
            </div>
            <div className={c.card}>
              <ul className={c.checks}>
                {r.points.map((p) => (
                  <li key={p}>
                    <StatusIcon name="check" size={16} className={c.check} />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={c.joinCta}>
              <Button href={r.cta.href}>{r.cta.label}</Button>
            </div>
          </div>
        </SectionFade>
      ))}
    </div>
  );
}
