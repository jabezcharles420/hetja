# Hetja: Design System v4, with v5, v6 and v7 (Claude Design handoffs)

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

Two later handoffs build on v4 without replacing its look. **v5** audited the
live site against v4 and designed what it lacked: the missing pages, register
and print, what happens when a tag breaks, and the A4 sheets. **v6** is a
polish pass over every screen, a set of new screens (the SOS followed to its
outcome, a dog's week and story, feeders' first names), the remaining map and
edge states, and desktop as an invitation to use a phone. **v7** adds the
three portals for professionals: admin (on a laptop), vet and NGO (on a
phone). Sections "Design v5", "Design v6" and "Design v7" below record what
each changed in the system.

## Authority

Two things are the source of truth, in this order:

1. **The handoffs**, kept in the repo. v4 at
   [`docs/design/v4-handoff/`](v4-handoff/README.md): the spec
   (`README.md`), the mocks (`*.dc.html`), the rendered boards (`*.jpg`) and
   the copy deck (`COPY_DECK.txt`). The map (screen 19) came later as its own
   handoff under [`v4-handoff/map/`](v4-handoff/map/). v5 at
   [`v5-handoff/`](v5-handoff/CONTRACT.md), v6 at
   [`v6-handoff/`](v6-handoff/CONTRACT.md) and v7 at
   [`v7-portals/`](v7-portals/CONTRACT.md), each a set of `.dc.html` boards,
   their rendered `.jpg`, and a `CONTRACT.md` that records the owner's
   decisions, which route each screen replaces, the API it needs, and every
   place the build ships something other than the mock (with the reason).
   Where v6 and v5 overlap, v6 wins; the table in v6's contract says which
   screen supersedes which. The grey paragraph under each v6 mock is the
   designer's rationale and is spec. The handoffs are marked *high fidelity*:
   colours, type sizes, spacing, radii and copy are final, and example data in
   them (Rani, Priya S., K/W, times) is data, not copy.
2. **[`packages/design/tokens.css`](../../packages/design/tokens.css)**, which
   holds the handoff's values verbatim under the repo's `--h-` prefix. Every
   CSS Module reads these tokens. Do not tune them by eye.

This document explains how the pieces fit and why the rules exist. If a number
here disagrees with `tokens.css`, `tokens.css` wins and this file has a bug. If
`tokens.css` disagrees with the handoff, that is a bug in `tokens.css`, with
one recorded exception (the tab bar background, below). v5 added six tokens;
v6 and v7 added none.

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
| `Logo`, `TopNav`, `TabBar`, `Footer`, `PrivacyBand` | Global chrome. `TabBar` has four tabs: Home, Map, Scan, Me (v6; v5 briefly had five, with Alerts). Since v7 a verified vet gets Home, Map, Vet, Me and an NGO member Home, Map, NGO, Me (`VET_TABS`, `NGO_TABS`, chosen by `lib/tab-role.ts`). `TopNav` is 52 px. |
| `AppHeader` | v5. The 52 px header of every focused screen: a back link ("‹ Me", or history back) or Cancel, an optional title and trailing action, a `memorial` tone, and a white fill with a hairline once the page scrolls. |
| `Segmented` | v5. A segmented control as a real radiogroup (arrow keys move the choice), 40 px segments. The vet checkup (N3) and Settings' SOS only / All. |
| `SettingsList` | v5. `SettingsGroup` (white card, radius 20) and `SettingsRow` (56 px: label, value or sub-line, chevron, `danger` tone, disabled, or a `control` slot for a `Switch`). Settings, Me's rows. |
| `Sheet` | v5. The modal bottom sheet: focus trapped, Escape and the scrim close it, focus returns to the opener, one pinned footer action and a Cancel. Every picker and confirm (wards, quiet hours, pause, delete account, name). |
| `Switch` | v5. The iOS-style 51 x 31 `role="switch"` inside a 44 px target, green when on; the label carries the meaning, not the colour. |
| `Aurora` | The per-screen aurora recipes, copied from the mocks. Marketing and reading pages only. |
| `StickyFooter` | Pins the main button to the bottom of the screen, respecting `env(safe-area-inset-bottom)`. |
| `SectionFade` | The marketing-only section fade (opacity plus a 12px rise, 400ms), off under `prefers-reduced-motion`. |

Which chrome a route gets is decided in one place,
`apps/web/components/ChromeShell.tsx`. Since v5's audit the rule is short:
**only the tab roots carry the TabBar** (`/`, `/scan`, `/me`, and since v7
`/vet` and `/ngo`; `/map` draws the same bar inside its own sheet and hides
it while a case is being taken).
**Every other app screen is a focused screen**: an `AppHeader` with back or
Cancel, no tab bar, no footer. The website `Footer` appears only on the
reading pages (About, How it works, FAQ, Privacy, Contact). `/hetja` keeps its muted header with a back link. 404s get a
way home. `/admin/**` (v7) gets no street chrome at all and draws its own
sidebar. The same file decides what happens on a desktop (below, "Design
v6" and "Design v7").

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
  so it claims nothing it cannot back. The SOS sent screen said a dog's
  feeders "are being told" until the API could say who; since v6 it names
  them from the case's own paging rows, and still falls back to the neutral
  sentence when it does not know.

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
- `apps/scan` ships an 11.2 KB subset (`assets/inter-scan.woff2`: weights 400
  to 700, printable ASCII less 20 symbols the collar page never shows, plus a
  handful of punctuation), served at `/d/inter-scan.woff2` with a 30-day cache
  while every other `/d/` path stays `no-store`. It was 13.6 KB until v6 needed
  the bytes; the dropped symbols are listed in `apps/scan/index.html` and fall
  back to the system font if copy ever uses one. The subset recipe is in
  `apps/scan/scripts/build.mjs`.
- `apps/web` also ships Noto Sans Devanagari Bold
  (`public/fonts/NotoSansDevanagari-700-devanagari.woff`, OFL-1.1), but only
  for the print PDF: it is fetched when a dog's name on a sheet is in
  Devanagari and embedded as a subset. No screen uses it.

The handoff originally said "no web fonts" on Scan and Profile. The subset is
the compromise: it sits after `-apple-system` in the stack, so Apple devices
never fetch it, and it fits inside the 40 KB budget.

Sizes, weights and tracking follow the handoff's type table (hero 60/0.98 on
mobile, 104/0.94 on desktop; screen title 34; dog name 40; body 17/1.47;
collar code mono 30 on the profile, 24 in the input). Minimum reading size is
15px, captions 13px.

## Colour and measured contrast

Output of `bash ops/contrast-gate.sh` on 2026-09-25. The gate runs in CI and
fails any documented pair below 4.5:1. All 22 pairs (v4's 21 and v5's vet
pill) pass WCAG AA.

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
| `--h-vet` | `--h-vet-bg` | 5.95:1 |
| `--h-warn` | `--h-warn-bg` | 5.35:1 |
| `--h-neutral` | `--h-neutral-bg` | 8.14:1 |
| `--h-danger` | `--h-danger-bg` | 5.88:1 |
| `--h-band-ink` | `--h-band` | 19.29:1 |
| `--h-band-sub` | `--h-band` | 8.16:1 |
| `--h-band-link` | `--h-band` | 6.96:1 |

`--h-tertiary` (`#86868b`) is for placeholders and chevrons only and is not in
the table on purpose: it is not a text colour. Neither are v5's
`--h-attention` (the orange alert dot and the F1 scan frame) and
`--h-control-off` (an unselected radio ring, an idle tab icon). Text over the aurora is also
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
   390 x 844 for phone screens and at 1440 for the desktop invitation and the
   map. Check 744 and 745 (the desktop switch) and 1024 for the desktop hero.
   For a design pass in Claude Design, `pnpm --filter @hetja/web
   screens:export` shoots the screens it knows into a folder next to the repo
   (AGENTS.md §h); the v6 boards name captures by its numbers.
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
| v5 F1 to F3 | Can't read this QR, partial code, find by ward and photo | `apps/web/components/QrScanner.tsx`, `components/scan/*` |
| v5 F4, F5 | Report a tag problem, found tag reported | `apps/scan/src/tag.ts` |
| v5 F6 | Feeder tag alert, reprint, history | `apps/web/app/me/dogs/[slug]/tag` |
| v5 N1 to N9 | Become a feeder, SOS alert (superseded by v6), vet checkup, My dogs, Alerts, Settings, no signal, no dog has this code (superseded by v6), update on a dog | `app/welcome`, `app/sos/[caseId]`, `app/vet/[slug]`, `app/me/dogs`, `app/alerts`, `app/settings`, `app/feed`, `app/me/dogs/[slug]/status` |
| v6 P1 to P6 | Confirm the collar, wrong tag, live, manage, print material, slots full | `apps/web/app/(register)/register/[slug]`, `.../print`, `new/SlotsFull.tsx` |
| v6 P7, P8, P12, P13, V15 to V19, N10 to N12, L7 | The collar page and its SOS: early button, unknown collar, no location, no signal, profile, no feeders, saved copy, what happened, sent, help coming, closed, location ask, open case | `apps/scan/src/{ui,sos,panel,format,firstaid}.ts`, `apps/scan/index.html` |
| v6 P9 to P11, L4 to L6, V21, V22 | The responder's SOS page, one layout per state | `apps/web/app/sos/[caseId]/SosCaseScreen.tsx` |
| v6 V1 to V14, V20, V23, L1 to L3, N13, N15, N16 | 404, scan tab, sign in, Me, feed, registrations, city summary, add to home screen, pause, alerts ask, dog week, story | across `apps/web/app` (see FEATURE-GUIDE.md Part 2 §2) |
| v6 M1 to M7 | Map: city, ward, signed out, taking a case, place, not logged today, cached | `apps/web/components/map/*` |
| v6 D1, D2 | Desktop invitation; collar page on desktop | `apps/web/components/DesktopInvite.tsx`; `apps/scan/src/ui.ts` |
| v7 A1 to A7 and the designed admin sections | The admin portal | `apps/web/app/admin/**`, `apps/web/components/admin/*` |
| v7 V1 to V5, V2b | The vet portal; V4's health list also on the collar page | `apps/web/app/vet/**`, `apps/web/components/vet/*`; `apps/scan/src/ui.ts` |
| v7 N1 to N5 | The NGO portal | `apps/web/app/ngo/**`, `apps/web/components/ngo/*` |
| 12 to 16 | About, How it works, FAQ, Privacy, Contact | `apps/web/app/{about,how-it-works,faq,privacy,contact}` |
| 17 | `/hetja` | `apps/web/app/hetja` |
| 19 | Map | `apps/web/app/map`, `components/map` |

The print sheets are physical artefacts printed on office printers and at
print shops, not screens. They keep their layout: no aurora, no shadow,
nothing that depends on colour, and no desktop invitation. Since v5 the paper
sheets are a PDF built in the browser at exact millimetres (the QR one vector
path of 0.49 mm modules on the 22 mm tag), with an HTML sheet at real size as
the fallback; the 40 x 40 mm laser sheet for etched TPU still prints with
`window.print()` and a print stylesheet that shows only the tag.

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
  `NEXT_PUBLIC_ESRI_API_KEY`. The attribution Esri requires is shown on the
  map. Without a key, or when Esri refuses the tiles, there is no tile layer:
  the mist background, the ward pills and the pins stay, and the map says
  "Street map unavailable. Wards are shown at their centres." The CARTO
  fallback is gone, because CARTO's keyless tiles now draw an "API key
  required" image instead of failing (docs/BUGS.md, 2026-09-25).
- The map follows the same rules as every other screen: one loud button, icon
  plus words, 44px targets, and no animation under reduced motion.

## Design v5 (2026-09-25)

The v5 boards (`v5-handoff/`) are an audit of the live site, the pages it was
missing (N1 to N9), register and print (R1 to R8), tag problems (F1 to F6)
and the A4 sheets. They keep v4's look and change the system in a few places:

- **Six tokens** in `packages/design/tokens.css`: `--h-vet-bg` / `--h-vet`
  (the "Vet account" pill, 5.95:1), `--h-attention` (orange alert dots and
  the F1 scan frame; never text), `--h-control-off` (an unselected radio
  ring, an idle tab icon), and `--h-camera` / `--h-camera-surface` for the
  dark camera screens (R2, F1).
- **A 52 px header.** The audit cut the top bar from 80 to 52 px:
  `--h-nav-h` is 52 px for `TopNav` and the new `AppHeader`. The tab bar row
  is `--h-tab-h` (49 px, icon plus label); the whole bar with the
  home-indicator area is `--h-tab-clear` (83 px on a modern iPhone), which is
  what fixed content must clear.
- **Focused screens.** Only the tab roots carry the tab bar; everything else
  is a focused screen with `AppHeader` and back or Cancel, and no footer (see
  ChromeShell above).
- **New components**: `AppHeader`, `Segmented`, `SettingsList`, `Sheet` and
  `Switch` (table above). Pickers and confirmations are bottom sheets, not
  dialogs in the middle of the screen, so the action sits under the thumb.
- **No languages yet.** The Settings "Language" segment (English / हिंदी /
  मराठी) is left out until human translations exist (owner decision).

Where v5 ships something other than its mock, `v5-handoff/CONTRACT.md` says
what and why. The ones that are visual: the tag QR is the signed collar URL
at the mock's printed sizes, not the mock's unsigned uppercase URL; a tag on
the wrong dog shows "Tag under review" but **never pauses SOS**; sign-in is
email only (no phone code); and "Download PDF" is a real vector PDF built in
the browser.

## Design v6 (2026-09-25)

The v6 boards (`v6-handoff/`) are a polish pass over every live screen (P1 to
P13, V1 to V23), new screens (N10 to N16), the map's and the app's remaining
states (M1 to M7, L1 to L7) and desktop (D1, D2). v6 wins wherever it
overlaps v5. It added no tokens and no components; what it changed:

- **Four tabs: Home, Map, Scan, Me.** Alerts left the tab bar. It is a row on
  Me with an unread count, and push notifications open it. This replaced v5's
  five tabs.
- **Every dog by name.** Screens name the dog ("Rani needs help", "With
  Rani", "Rani has eaten.") and its feeders by first name ("Tells Priya,
  Arjun and a vet nearby."). First names only, never surnames or contact
  details, and every feeder can turn it off in Settings ("Show my first name
  on dogs' pages", on by default); an opted-out feeder is counted, not named
  ("Rani has 2 feeders"). Pronouns follow the dog's recorded sex, and fall
  back to words that need none.
- **Desktop is an invitation** (D1, D2). Hetja is made for the street, so
  above 744 px (`@media (min-width: 745px)`) an app route does not stretch
  into a desktop layout: it shows one page, "Hetja lives on your phone.",
  with a QR of the current URL (scanning the map on a laptop opens the map on
  the phone), today's dog count and an illustrated phone labelled "An example
  of a dog's page." The collar page does the same with its own QR, and keeps
  a working SOS button (D2). The reading pages (About, How it works, FAQ,
  Privacy, Contact), `/hetja` and 404s open in the phone layout, centred in a
  480 px column. `/sos/**` is framed the same way, so a responder at a desk
  can still act. The print sheets and `/design` are left as they are.
  `ChromeShell.tsx` marks each route `invite`, `frame` or `none`.
- **Honest limits, drawn.** A case someone else took names who (L4), a
  responder who may not respond sees the real checklist (V22), a saved copy
  says when it was saved (V17, V9, M7), a street map that cannot load says so.
- **The sign-in code works for 5 minutes.** V5's mock says 10; the owner's
  standing decision on the code's lifetime wins.

v6's own adapted list (in `v6-handoff/CONTRACT.md`) covers the rest: P13's
"Open Messages" has no recipient because Hetja never holds a feeder's number;
V22's checklist is the real responder rule, not the mock's placeholder count;
"open now" is shown only where the hours can be computed; D1's phone is an
illustration, never a fake dog presented as real; and the dogless SOS that
F1 and P8 both drew is built, with a location required and Mumbai only.

## Design v7: the portals (2026-09-26)

The v7 board (`v7-portals/`, one bundled page with A1 to A7 for admin, V1 to
V5 and V2b for vets, N1 to N5 for NGOs; `portals-text.txt` is its text per
screen) adds three portals for professionals. The screens it links to but
does not draw (admin Dogs, Feeders, Collars, SOS cases, Reports, Settings;
the vet and NGO status, profile and list screens) were designed during the
build in the board's language. v7 added **no tokens**: every colour the
portals use is already in `tokens.css`, plus a few local variables in
`components/admin/admin.module.css` (`--a-warn`, `--a-selected` and the like).

- **Black is the primary button in the portals.** The board draws the main
  action of a professional screen (Verify Dr. Qureshi, Merge into Kalu, Send
  Dr. Qureshi, Sign, Plan the drive) as a black pill (`--h-ink`), not blue:
  it is a working tool, and blue stays the street app's "do the normal
  thing". In code: admin `.btnDark`, vet `.dark`, NGO `.inkBtn`. Red is still
  SOS and nothing else ("I'll take it", "This dog needs help"). Blue remains
  for secondary header actions and links (admin `.btnBlue`, NGO `.pillBlue`).
  Destructive actions are an outline in `--h-sos`, and the confirm dialog
  names what will happen.
- **The admin portal is the one desktop layout** (A1 to A7). A 232 px
  sidebar (Today, Vets, NGOs, Dogs, Avatars, Feeders, Collars, SOS cases,
  Reports; then Team & roles, Audit log, Settings) whose counts match the
  rows so nothing hides; a content area that is either one column (40 to 48
  px padding) or **list-with-detail**: a table with the selected row open in a
  sticky right panel (`clamp(400px, 33vw, 520px)`), the selection in the URL
  (`?id=`), Esc and the arrow keys to move. A1 is a task list, not a dashboard
  of charts: each row opens the exact screen that clears it. Search is ⌘K /
  Ctrl K. Below 1024 px it shows "Admin works on a laptop" instead of
  squeezing; it never shows the phone invitation (D1).
- **Vet and NGO are phone screens**, built from v4 and v6 patterns: the
  52 px `AppHeader`, `SettingsList` rows, bottom `Sheet`s for every update
  (ambulance in or out, beds free, SOS hours), `Segmented` and `Switch`. The
  role tab bars put Vet or NGO third (Home, Map, Vet, Me; Home, Map, NGO, Me),
  and "Scan a collar" moves inside that tab. The board labels the fourth tab
  "Profile" on V2b and N2; the build keeps "Me", per the contract.
- **Two kinds of health record, always labelled.** "✓ Vet signed" (a black
  badge, with the vet's name, council number and the batch) and "Feeder
  noted" (quiet, with the feeder's first name) on the collar page, the app
  and the certificate. A correction shows the old value struck through; a
  withdrawn record comes off the page. Colour never carries it alone: the
  words do.
- **"Government vet · free".** Wherever a government vet or hospital appears
  it says so, with "free" in the label (`apps/web/lib/care-label.ts`,
  `apps/scan/src/format.ts`). Private clinics show their cost tier as before.
- **The signing moment.** The button names the phone's own method: "Sign
  with Face ID" on an iPhone or iPad, "Sign with your screen lock" elsewhere.
  It is a passkey assertion, and the copy says what it does ("It stays on
  this phone, and it makes every record you sign checkable").
- **The certificate** is a PDF built in the browser like the collar sheets:
  vet-signed records only, and a footer saying so.

Where v7 ships something other than its mock, `v7-portals/CONTRACT.md` says
what and why. The visual ones: A2's "Found on the MSVC register" is an
admin's checklist tick with a link to the council's register (there is no
API); A3's "By photo · 94%" matching is not built (avatars match by the dog's
code or the collar batch number in the file name, else "No match · pick
dog"); collar numbers are the collar's batch number where set, else the
3-3-3 code; and NGOs cover Mumbai wards only.

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
