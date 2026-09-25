# Hetja: Design System v4 (Claude Design handoff)

This replaces v3 (the Apple / Sidehoe direction built from `components/ui`,
glass, Dogmoji stickers and a `/styleguide` page). v3 in turn replaced v2
("Swiss wayfinding") and v1 (cream/forest/amber). None of them survives in
`apps/web` or `apps/scan`: the v3 kit was deleted in commit `5a45d02`, and
every screen was rebuilt against the v4 handoff in the commits that followed.

v4 was designed in Claude Design and handed over as HTML mocks, rendered
boards and a written spec. It keeps the product exactly as it was and
changes the look: big tight bold headlines, a soft pink and peach aurora on
marketing pages only, a frosted nav, blue pill buttons, white rounded cards,
a black privacy band, plain white screens where speed matters, and dry copy.

## Authority

Two things are the source of truth, in this order:

1. **The handoff**, kept in the repo at
   [`docs/design/v4-handoff/`](v4-handoff/README.md): the spec
   (`README.md`), the mocks (`*.dc.html`), the rendered boards (`*.jpg`) and
   the copy deck (`COPY_DECK.txt`). The map (screen 19) came later as its own
   handoff under [`v4-handoff/map/`](v4-handoff/map/). The handoff is marked
   *high fidelity*: colours, type sizes, spacing, radii and copy are final.
2. **[`packages/design/tokens.css`](../../packages/design/tokens.css)**, which
   holds the handoff's values verbatim under the repo's `--h-` prefix. Every
   CSS Module reads these tokens. Do not tune them by eye.

This document explains how the pieces fit and why the rules exist. If a number
here disagrees with `tokens.css`, `tokens.css` wins and this file has a bug. If
`tokens.css` disagrees with the handoff, that is a bug in `tokens.css`, with
one recorded exception (the tab bar background, below).

Two surfaces consume the tokens:

- `apps/web/app/globals.css` imports `tokens.css` directly.
- `apps/scan/index.html` hand-copies the tokens it uses into an inline
  `:root`, because the collar page cannot afford a second stylesheet request
  inside its 40 KB budget (INVARIANT 13). Every name and value it carries must
  match `tokens.css` exactly, font stack included.

To open the mocks themselves, put `support.js` and `image-slot.js` from the
original Claude Design zip next to them; they are Claude Design's viewer
scripts and are not committed. The `.jpg` boards need nothing.

## Components: `apps/web/components/ds`

Build screens from these; import them from `@/components/ds`. Each one exposes
a slot for every piece of text the mocks show, so no screen needs to fork a
component to match its mock.

| Component | What it is |
|---|---|
| `Button` | `primary` (56 tall, blue), `sos` (60 tall, red, white "!" circle), `quiet`, `tinted` (the "Call" button), `link`, `navPill`. Pressed state darkens and scales to .98. |
| `StatusPill` + `StatusIcon` | ok / warn / neutral / danger pills. The icon (check, clock, cross, alert) is required, not optional. |
| `Label` | 13px uppercase section label. |
| `CollarCode` | The code in three groups of three (`DDR 017 XK2`), a Copy button and the optional "Say it: D D R · zero one seven · X K two" line. |
| `CollarCodeInput` | 60 tall mono input that uppercases for display, spaces every three characters and accepts 9 characters, with prompt, helper and error slots. |
| `Card` | White, radius 28, padding 24. |
| `ListRow` / `ListGroup` | Rows with avatar, title, sub and a trailing pill or button; dividers between rows, not after the last. |
| `DogAvatar` | Pastel circle with the dog's initial; the pastel is picked by a stable hash of the dog id, so a dog keeps its colour forever. |
| `Badge`, `Progress` | The Me screen's streak badges and trust bar. |
| `Logo`, `TopNav`, `TabBar`, `Footer`, `PrivacyBand` | Global chrome. `TabBar` has four tabs: Home, Map, Scan, Me. |
| `Aurora` | The per-screen aurora recipes, copied from the mocks. Marketing and reading pages only. |
| `StickyFooter` | Pins the main button to the bottom of the screen, respecting `env(safe-area-inset-bottom)`. |
| `SectionFade` | The marketing-only section fade (opacity plus a 12px rise, 400ms), off under `prefers-reduced-motion`. |

Which chrome a route gets is decided in one place,
`apps/web/components/ChromeShell.tsx`: marketing pages get TopNav, Footer and
the TabBar (below 1024px); `/hetja` gets only its muted nav; `/me` gets only
the TabBar; focused flows (`/scan`, `/feed`, `/login`, `/register/**`,
`/design`) and `/map` get none and draw their own back or cancel; anything
else (404s) gets TopNav and Footer so nobody is stranded.

`/design` lays the components out exactly like the handoff's Design System
mock, so the two can be compared side by side. It is development only: it
answers 404 in production unless `HETJA_STYLEGUIDE=1` and is never indexed.

## The rules

These come from the handoff's "Hard rules" and from the product's older
signage-era discipline. They are not preferences.

- **One loud button per screen.** Blue `#0071e3` is for normal actions. Red
  `#d70015` is for SOS and nothing else. A screen that seems to need two loud
  buttons needs a second screen.
- **Colour never carries meaning alone.** Every status pill has an icon and
  words. "Vaccination unknown" is a neutral pill with a clock and those words;
  it is never a blank. The Sterilised toggle on New dog is green when on, but
  the label carries the meaning.
- **Touch targets are at least 44px** (`--h-target`). Main buttons are 56px
  tall, the SOS button 60px.
- **Main buttons sit in the bottom third**, pinned with `StickyFooter`, where a
  thumb reaches them one-handed.
- **Scan, the dog profile and SOS are plain white and fast.** No aurora, no
  decorative animation, minimal JS. They are the screens a stranger opens on a
  budget Android over 4G while standing next to a dog. The profile and SOS
  steps live in `apps/scan`, which has no framework at all.
- **`/hetja` is calm.** Off-white `#fbfbfa`, no animation, no blue, no red.
  It is a memorial; grief is neither an action nor an emergency.
- **Location is ward-level only on every public screen**, written like
  `K/W ward · Andheri West`, never a street (INVARIANT 2).
- **Copy is the mock's copy, verbatim, with no em dashes.** Warm and dry on
  marketing pages, plain on the dog and SOS screens. Where real data replaces
  a mock placeholder (412 dogs, "3 of Bruno's feeders"), the real number is
  fetched, and where the API does not know a number the sentence is rewritten
  so it claims nothing it cannot back. The SOS sent screen, for example, says
  a dog's feeders "are being told" instead of inventing a count.

Where the build deliberately departs from a mock, the reason is a rule that
outranks it:

- The SOS sent screen has **no feeder Call row**, though the mock draws one.
  Feeders' phone numbers are never stored or shared (INVARIANT 3).
- The **tab bar background is `rgba(255,255,255,.96)`**, not the handoff's
  `.92`. Over the black privacy band `.92` blends to `#ebebeb` and the inactive
  labels fall to 4.25:1; `.96` blends to `#f5f5f5` (4.65:1).

## Type and fonts

```
--h-font:  -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
           "Inter", "Helvetica Neue", Roboto, Helvetica, Arial, sans-serif
--h-mono:  ui-monospace, "SF Mono", Menlo, "Roboto Mono", monospace
--h-serif: "Iowan Old Style", "Palatino Linotype", Georgia, serif   (/hetja essay only)
```

**SF Pro comes from the system on Apple devices**, and because the system
fonts match first, an iPhone or Mac never downloads anything. SF Pro itself
may not be shipped to non-Apple platforms under Apple's licence, so
**Android gets Inter**, the closest licensable stand-in:

- `apps/web` self-hosts the variable Latin Inter
  (`public/fonts/Inter-latin-var.woff2`, 48 KB, OFL-1.1).
- `apps/scan` ships a 13.6 KB subset (`assets/inter-scan.woff2`: weights 400
  to 700, printable ASCII plus a handful of punctuation), served at
  `/d/inter-scan.woff2` with a 30-day cache while every other `/d/` path stays
  `no-store`. The subset recipe is in `apps/scan/scripts/build.mjs`.

The handoff originally said "no web fonts" on Scan and Profile. The subset is
the compromise: it sits after `-apple-system` in the stack, so Apple devices
never fetch it, and it fits inside the 40 KB budget.

Sizes, weights and tracking follow the handoff's type table (hero 60/0.98 on
mobile, 104/0.94 on desktop; screen title 34; dog name 40; body 17/1.47;
collar code mono 30 on the profile, 24 in the input). Minimum reading size is
15px, captions 13px.

## Colour and measured contrast

Output of `bash ops/contrast-gate.sh` on 2026-09-24. The gate runs in CI and
fails any documented pair below 4.5:1. All 21 pairs v4 uses pass WCAG AA.

| Text | Background | Ratio |
|---|---|---|
| `--h-ink` | `--h-white` | 16.83:1 |
| `--h-ink` | `--h-mist` | 15.46:1 |
| `--h-ink` | `--h-aurora-base` | 15.80:1 |
| `--h-ink` | `--h-memorial-bg` | 16.25:1 |
| `--h-secondary` | `--h-white` | 5.07:1 |
| `--h-secondary` | `--h-mist` | 4.66:1 |
| `--h-secondary` | `--h-aurora-base` | 4.76:1 |
| `--h-secondary` | `--h-memorial-bg` | 4.90:1 |
| `--h-text-mid` | `--h-white` | 9.09:1 |
| `--h-link` | `--h-white` | 5.57:1 |
| `--h-link` | `--h-mist` | 5.11:1 |
| `--h-white` | `--h-blue` | 4.70:1 |
| `--h-white` | `--h-sos` | 5.38:1 |
| `--h-blue-tint-ink` | `--h-blue-tint` | 5.20:1 |
| `--h-ok` | `--h-ok-bg` | 4.77:1 |
| `--h-warn` | `--h-warn-bg` | 5.35:1 |
| `--h-neutral` | `--h-neutral-bg` | 8.14:1 |
| `--h-danger` | `--h-danger-bg` | 5.88:1 |
| `--h-band-ink` | `--h-band` | 19.29:1 |
| `--h-band-sub` | `--h-band` | 8.16:1 |
| `--h-band-link` | `--h-band` | 6.96:1 |

`--h-tertiary` (`#86868b`) is for placeholders and chevrons only and is not in
the table on purpose: it is not a text colour. Text over the aurora is also
checked in a real browser by axe (`apps/web/e2e/a11y.spec.ts`).

## Motion

App screens have none beyond the native press state. Marketing pages may fade
sections in (`SectionFade`), and the home aurora may drift very slowly; both
are gated on `prefers-reduced-motion: no-preference` in CSS, and
`--h-dur` drops to 0 under `reduce`. Nothing waits on an animation to become
visible. Scan, Profile, SOS and `/hetja` never animate.

## Verifying a screen

UI work is not done when it typechecks. It is done when it matches its mock.

1. Open the mock (or its `.jpg` board) and the running screen side by side, at
   390 x 844 for phone screens and at 1440 for the desktop landing and the
   map. Check 744 for two-column cards and 1024 for the desktop hero.
2. Compare type sizes, spacing, radii, colours and the position of the main
   button, not just "looks close".
3. Ship **all** of the mock's copy, verbatim. Older real content that the mock
   does not cover is kept, restyled, below the mock's sections.
4. Run the gates: `bash ops/contrast-gate.sh`, the web unit tests, and the
   Playwright specs (`e2e/a11y.spec.ts`, `e2e/mobile-layout.spec.ts`, which
   asserts gutters and no horizontal scroll per route at 390px). For anything
   in `apps/scan`, `pnpm --filter @hetja/scan size:gate`.
5. `grep` the change for em dashes. There should be none.

## Screens

Numbers match the mock labels.

| # | Screen | Where |
|---|---|---|
| 01, 18 | Home (phone, 744 two-column, desktop landing) | `apps/web/app/page.tsx` |
| 02 | Scan | `apps/web/app/scan` (`components/QrScanner.tsx`) |
| 03 | Dog profile | `apps/scan` at `/d/<code>` |
| 04, 05 | SOS step 1, SOS sent | `apps/scan` (`src/sos.ts`) |
| 06 | Log a feed | `apps/web/app/feed` |
| 07, 08 | Sign in, code | `apps/web/app/login` |
| 09 | Me | `apps/web/app/me` |
| 10, 11 | New dog, Collar ready (replaced by v5 R1 to R6) | `apps/web/app/(register)/register/new`, `.../[slug]/ready` |
| v5 R1 to R8 | Register a dog, photo, duplicate check, about, confirm, code ready, print tag, batch sheet | `apps/web/app/(register)/register` (`page`, `new`, `[slug]/ready`, `[slug]/print`, `batch`); PDF in `apps/web/lib/collar-pdf.ts` |
| 12 to 16 | About, How it works, FAQ, Privacy, Contact | `apps/web/app/{about,how-it-works,faq,privacy,contact}` |
| 17 | `/hetja` | `apps/web/app/hetja` |
| 19 | Map | `apps/web/app/map`, `components/map` |

The print sheet (`register/[slug]/print`) is a physical artefact printed on
office printers, not a screen. It keeps its layout: no aurora, no shadow,
nothing that depends on colour. The Collar ready screen's **Print collar**
uses `window.print()` with a print stylesheet that shows only the tag, at
40 mm.

## The map (screen 19)

The map is a later addition to v4, from its own handoff
(`v4-handoff/map/Hetja Map.html`, with `Hetja Map Mobile.html` framing it at
390px and four rendered boards). It shows all of Mumbai: one pill per BMC ward,
and pins for vets and NGOs.

- **Wards, not dogs.** Each ward's marker sits at a fixed, hand-placed ward
  centre (`BMC_WARD_CENTROIDS` in `packages/contracts/src/wards.ts`) and shows
  counts only: dogs with collars, how many are not fed today, open SOS cases.
  The privacy line on the sheet says it outright: "Dogs are shown by ward, never
  by street. Vets and NGOs are public places, so they get a pin."
- **Chips** filter the map: Needs help (the "!" icon), Not fed today (clock),
  Vets ("+"), NGOs ("N"). Each chip has an icon and a word.
- **One sheet**, a bottom sheet on phones and a 420px left panel from 900px,
  shows the city ("Mumbai right now", the hungriest wards), a ward (its cases
  by severity and time, and up to three nearby vets and NGOs) or a place (hours,
  ambulance, phone, and a Call button). The one loud button is "I can go and
  help" when a ward has an open case with nobody on it, otherwise "Get alerts
  for {ward} ward".
- **Mumbai only.** The map cannot be panned outside Greater Mumbai
  (`MUMBAI_BOUNDS`, the 24 wards' extent plus a 4 to 5 km margin) and has a
  minimum zoom of 10.
- **Tiles** are Esri's Light Gray basemap (the mock's), from the ArcGIS
  Location Platform static basemap tiles service, with the key in
  `NEXT_PUBLIC_ESRI_API_KEY`. Without a key, or when Esri refuses the tiles,
  the layer swaps to CARTO's keyless light tiles so the map never goes blank.
  The attribution Esri and CARTO require is shown on the map.
- The map follows the same rules as every other screen: one loud button, icon
  plus words, 44px targets, and no animation under reduced motion.

## Accessibility

- A global `:focus-visible` ring (`3px solid rgba(0,113,227,.45)`, offset 2px)
  covers every control. Nothing suppresses it.
- Contrast is gated in CI (table above) and checked by axe in a real browser.
- The aurora is a CSS background on the section that carries it, never a
  content element, so there is nothing for a screen reader to trip over.
- The collar code is announced as spaced characters ("Collar code d d r 0 1
  7 ...") and has a written "Say it" line, because it is the string a caller
  reads aloud to an NGO over the phone.
- Mobile layout is gated: `e2e/mobile-layout.spec.ts` checks gutters and
  horizontal overflow at 390px on every static route.

## What this document is not

It does not repeat `tokens.css` values or component props, and it does not
specify page copy; the handoff and the copy deck do. It does not cover the
care-directory data model or SOS routing, which live in
[`docs/HOW-IT-WORKS.md`](../HOW-IT-WORKS.md). Visual decisions only, with the
reason for each.
