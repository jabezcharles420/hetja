/**
 * The desktop pages' words (design v9, the owner's "Hetja Desktop" export),
 * verbatim. The phone pages carry the same copy in their own files; FAQ and
 * the memorial read the shared data (app/faq/questions.ts, app/hetja).
 */

export const HOW_ROWS = [
  ["A feeder registers the dog", "Name, photo, ward. Hetja prints a collar tag with a random code."],
  ["Feeders log each meal", "Scan, tap, done. The profile shows when the dog last ate."],
  ["Vets add records", "Shots, sterilisation, treatment. Locked once saved."],
  ["Anyone can raise an SOS", "It goes to the dog's feeders and the nearest vet on Hetja."],
] as const;

export const HOW_STEPS = [
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

export const HOW_OFFLINE = [
  "Profile data is cached on your phone after the first scan.",
  "Feeds and SOS reports are queued safely on-device.",
  "Everything flushes automatically the moment you're back online.",
];

export const MISSION = [
  { title: "A memory", text: "Every dog has a profile that outlives any one feeder's phone." },
  { title: "A ledger", text: "Feeds and vet records, in order, with names attached." },
  { title: "A voice", text: "An SOS that reaches someone who can actually come." },
];

export const COLLAR_STEPS = [
  { n: "01", title: "Collar", text: "Every dog in the programme wears a weatherproof collar with a printed QR and a 9-character code." },
  { n: "02", title: "Scan", text: "Any phone reads it. No app needed for a single scan, no account required to look. It works with no signal at all." },
  { n: "03", title: "Act", text: "Feed, raise an SOS, or send a vet note. Every act is logged against the dog's file and credited to you." },
];

export const LEDGER = [
  "Every medical record is hashed and chained to the one before it. Edit one, and the whole chain is visibly broken.",
  "Only identity-verified vets can add medical records, and each one is signed.",
  "A correction never deletes the past. It adds a new, clearly labelled record.",
  "You don't have to take our word for it. The chain is verifiable, and the 'verified' badge only appears on records that pass.",
];

export const PHASES = [
  { tag: "Phase 0", title: "The pilot", dogs: "~50 dogs", text: "A handful of dogs, trusted feeders, and one partner vet clinic. We prove the whole loop (collar, scan, feed, record) before anything scales." },
  { tag: "Phase 1", title: "A few wards", dogs: "1,000 dogs", text: "The feeder network widens and a first NGO plugs in. Vets begin signing records into the ledger." },
  { tag: "Phase 2", title: "One BMC zone", dogs: "10,000 dogs", text: "An entire zone covered. ABC units and BMC health staff read live coverage data, and every ward's dogs start to be counted honestly." },
  { tag: "Phase 3", title: "The whole state", dogs: "100,000 dogs", text: "Maharashtra's strays. Open to every citizen and every authority, from the neighbourhood feeder to the municipal planner." },
];

export const ROLES = [
  {
    label: "Feeders",
    title: "The daily bowl is the heart of this network.",
    text: "You probably already feed someone. Scan the collar, tap once, and the dog's page says they've eaten, so nobody gets double dinner and nobody gets none.",
    points: [
      "Log a feed in two taps, even with no signal: it sends itself later.",
      "Keep a streak, and build a trust score your ward can rely on.",
      "Get told when a dog you feed needs help, and only in the wards you pick.",
    ],
    cta: "Start feeding on your phone",
    href: null,
  },
  {
    label: "Vets",
    title: "Sign the record once, and it stays true.",
    text: "Verify and sign records into the tamper-evident ledger, so a dog's medical story is something everyone can trust.",
    points: [
      "Shots, sterilisation and treatment, signed with your passkey.",
      "Medical records can't be edited or deleted. Corrections go on top, with a name and a date.",
      "See the dogs near you whose vaccinations are due.",
    ],
    cta: "Sign records on your phone",
    href: null,
  },
  {
    label: "NGOs and shelters",
    title: "Run the drives with real numbers.",
    text: "Run ABC drives and shelter intakes with live coverage data. Adopt the collar programme for the territory you already protect.",
    points: [
      "An SOS in your wards reaches your coordinators first.",
      "Dispatch a member, with or without the ambulance.",
      "Ward-level coverage, never a dog's exact spot.",
    ],
    cta: "Bring your NGO to Hetja",
    href: "mailto:hello@hetja.in?subject=Partnerships",
  },
];

export const PRIVACY_SHORT = [
  { ok: true, title: "Ward only", text: "Dogs are placed by ward. No map pins, no street names." },
  { ok: true, title: "Random codes", text: "You can't guess the next dog from this one." },
  { ok: false, title: "No ads, no tracking", text: "Your email is for sign-in codes. That is all it is for." },
];

export const PRIVACY_SECTIONS: { label: string; title: string; sub: string; items: { title: string; text: string; scope?: string }[] }[] = [
  {
    label: "What we store",
    title: "Four things, and nothing more.",
    sub: "",
    items: [
      { title: "Your email address, hashed", text: "We never store your bare email address. We store a one-way hash built with a per-app secret, so your address can't be read back from our database." },
      { title: "Your acts, as a log", text: "Feeds, SOS reports, and vet notes you make are logged against the dog's file and your account. These are what build your streak and trust score." },
      { title: "Location, coarsened", text: "We only keep location at ward or cell level, the same grain as a neighbourhood. Exact coordinates are never stored, on any tier." },
      { title: "The medical ledger", text: "Vet-signed records belong to the dog, not to any person. They are part of the public, tamper-evident history of that animal." },
    ],
  },
  {
    label: "Location",
    title: "We know the street, never the spot.",
    sub: "Coordination needs a neighbourhood. Privacy needs you to stay anonymous. We solve both by keeping every location coarse.",
    items: [
      { title: "Ward", text: "Your feed is attached to the ward where the dog lives: enough to coordinate with other feeders, and nothing more." },
      { title: "Cell", text: "Coverage maps use anonymous cells (several hundred metres across) that combine many people's activity. No individual is visible in them." },
      { title: "Never exact", text: "No one, not even Hetja staff, can look up where you stood when you logged a feed." },
    ],
  },
  {
    label: "Who sees what",
    title: "Access is a ladder, not a free-for-all.",
    sub: "More responsibility means more access, and more of your identity on the line.",
    items: [
      { title: "Everyone", text: "The dog's name, ward, status, verified medical records, and micro-story are public. That's the point: the network works because anyone can look.", scope: "Read · dog profile" },
      { title: "Feeders", text: "You can always see your own feed history, streaks, and trust score. Other feeders are shown only by first name and ward, never an email address.", scope: "Read · own log" },
      { title: "Vets", text: "Identity-verified vets can add and sign medical records. Their entries are publicly attributed, because a signed ledger is what makes it trustworthy.", scope: "Write · medical ledger" },
      { title: "BMC and NGOs", text: "Authorities see aggregated, k-anonymized coverage data for ABC and vaccination planning. No personal information is included.", scope: "Read · aggregate coverage" },
    ],
  },
  {
    label: "Your rights",
    title: "DPDP-aligned, and yours to use.",
    sub: "",
    items: [
      { title: "Access", text: "Ask us and we'll show you exactly what we hold about you. It's usually just your hashed email address and your act log." },
      { title: "Correction", text: "A wrong record about you can be corrected. On the dog's medical ledger, corrections are added as new signed records, never edits." },
      { title: "Erasure", text: "Request deletion and we remove your personal data (your hashed email address, your act log, your feed history) within 30 days." },
      { title: "Consent", text: "DPDP-aligned consent, versioned and recorded, is asked at sign-up. You can withdraw it the same way you gave it." },
    ],
  },
];

export const PARTNERS = [
  { title: "NGOs and shelters", text: "Collar deployment and ABC drive data for your territory." },
  { title: "Vets", text: "Clinic onboarding, ledger access, and verification flows." },
  { title: "BMC and authorities", text: "Honest, ward-level coverage data for planning." },
];
