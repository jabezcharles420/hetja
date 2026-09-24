import type { FaqGroup } from "@/components/FaqList";

/* Pages 14 groups the questions as Feeders / Vets / Everyone. The mock's own
 * rows lead each list; every question from the previous page is kept (the
 * old "NGOs & BMC" and "Citizens" groups now live under Everyone). */
export const FAQ_GROUPS: FaqGroup[] = [
  {
    label: "Feeders",
    items: [
      {
        q: "Can I feed a dog that isn't mine?",
        a: "Street dogs aren't anyone's, which is the point. Log the feed so the dog's other feeders know it has eaten.",
      },
      {
        q: "What if the collar is missing?",
        a: "Report it from the dog's profile, and a feeder or vet in that ward will be alerted. A damaged collar means the dog could lose their file, so the sooner we know, the sooner we can reissue. If the collar is gone, report the last-seen location so we can match the dog by photo and ward.",
      },
      {
        q: "How is my streak counted?",
        a: "A day counts when you log at least one feed that day, Mumbai time. Feed on back-to-back days and it grows. Miss a day and it starts again from zero; there is no backfilling it. Five feeds in one day still count as one day.",
      },
      {
        q: "Do I need to be an NGO?",
        a: "No. Anyone can scan a collar, log a feed or raise an SOS. Sign in with your email to keep a streak and to register a dog you look after; registering is a role you switch on yourself in your profile.",
      },
      {
        q: "Do I need an account to log a feed?",
        a: "No. You can act as a guest, and the feed still counts toward the dog's log. With an account you keep your streaks and build a trust score, which is what lets vets and BMC take your reports seriously.",
      },
      {
        q: "How do I know the dog has been fed already?",
        a: "The profile shows recent feeds and last-seen time. It's not a live camera; it's a shared log. If the log is stale, the dog probably needs you more than ever.",
      },
    ],
  },
  {
    label: "Vets",
    items: [
      {
        q: "How do I verify a dog's medical records?",
        a: "Sign in with your registered clinic. The ledger chains every record to the one before it, so you can check a record's hash against the chain. Only records you and your colleagues have signed show up as verified on the public profile.",
      },
      {
        q: "Can I edit or delete a record?",
        a: "No, that's the point. A tamper-evident ledger can't be quietly changed. If a record needs correcting, add a new signed record that says so. The old one stays, visibly, with the correction linked to it.",
      },
      {
        q: "How do I get vet access?",
        a: "Write to hello@hetja.in with your clinic's name and registration. We verify your identity once, then your records are publicly attributed to you. That attribution is what makes the ledger trustworthy.",
      },
    ],
  },
  {
    label: "Everyone",
    items: [
      {
        q: "I found a collar on a dog. What should I do?",
        a: "Leave it on. The collar is how the dog keeps their identity, medical file, and network. Scan it with your camera, or type the 9-character code into the scan box. If the collar is loose or damaged, report it from the dog's profile.",
      },
      {
        q: "I think a dog needs help. How do I report it?",
        a: "Open the dog's profile and hit the SOS button. Choose how serious it is and what you saw, and the report fans out to nearby feeders and responders in that ward. Don't wait for an account; an SOS works as a guest.",
      },
      {
        q: "Is the information on a profile reliable?",
        a: "Medical records are only shown when a verified vet signed them, and the tamper-evident chain means they can't be quietly edited. Feeds and stories are honest, human logs: you can see who posted them, and stale data is easy to spot.",
      },
      {
        q: "Is my personal data used for anything else?",
        a: "No. No ads, no data selling, no location tracking. Your email address is stored only as a one-way hash, your location only at ward level, and you can erase it all on request. Details are on the privacy page.",
      },
      {
        q: "How does ABC integration work?",
        a: "A dog with an ABC drive completed is marked 'ABC done' on their profile by the vet who performed the surgery. That status lives in the ledger and feeds straight into coverage maps, so drive planners see which wards are genuinely done and which aren't.",
      },
      {
        q: "Can we use the coverage data for planning?",
        a: "Yes. Coverage data is aggregated to anonymous cells with k-anonymity: enough to plan a drive, never enough to track an individual. Ward and zone summaries are available to registered NGOs and BMC on request.",
      },
      {
        q: "How do we partner with Hetja?",
        a: "We'd love to hear from you. Write to hello@hetja.in and we'll work out collar deployment, data sharing, and reporting for your territory.",
      },
    ],
  },
];
