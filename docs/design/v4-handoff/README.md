# Handoff: Hetja redesign (design system, mobile screens, desktop landing)

Target repo: `jabezcharles420/hetja` (Next.js, CSS Modules).

## Overview
Hetja is a free, open-source web app for Mumbai street dogs. Dogs wear a collar with a QR code. Scanning it opens the dog's profile (name, ward, vaccinated and sterilised status, a short story, and when it was last fed). Feeders log feeds and keep a streak. Vets add medical records that can't be edited. Anyone can raise an SOS.
This redesign keeps the product the same and changes the look to an Apple product-page style: big tight bold headlines, a soft pink and peach aurora on marketing pages, a frosted nav, blue pill buttons, white rounded cards, a black privacy band, and dry copy. Design phone-first at 390px.

## About the design files
The `.dc.html` files in this folder are **design references made in HTML**. They are not production code. Rebuild them in the existing Next.js app using its patterns (App Router or Pages, whichever the repo already uses), with **CSS Modules** for styling. The HTML uses inline styles only because of how the mocks were written. In the app, move every value into CSS custom properties (see Design tokens) and module classes.

To view a file, open it in a browser from this folder. `support.js` and `image-slot.js` have to sit next to the files.

## Fidelity
**High fidelity.** Colours, type sizes, spacing, radii and copy are final. Match them closely. The only exceptions are these placeholders:
- **Dog photos and 3D avatars** are drag-and-drop image slots. In the app, use real uploads for photos. For avatars, use the pastel fallback circle with the dog's initial until renders exist (see Assets).
- **Live numbers** (412 dogs, 1,086 feeds) are made up. Fetch the real counts.
- **/hetja songs** are shown as `[Song title]` / `[Artist]`. Keep the existing essay and songs from the current page, unchanged.

## Hard rules (from the brief, and enforced in the design)
1. One loud button per screen. Blue `#0071e3` is for normal actions. Red `#d70015` is for SOS only.
2. Colour never carries meaning alone. Every status pill has an icon plus words.
3. Text contrast is at least 4.5:1. Touch targets are at least 44px, and main buttons are 56px tall (60px for SOS). Main buttons are pinned in the bottom third of the screen.
4. The collar code is large and monospaced, shown uppercase in groups of three: `DDR 017 XK2`. Store it lowercase (`ddr017xk2`). The input accepts any case and spaces it automatically.
5. Location is shown at ward level only, e.g. `K/W ward · Andheri West`. Never a street.
6. Scan and Dog profile have a plain white background: no aurora, no decorative animation, no web fonts, minimal JS. They must load fast on budget Android over 4G.
7. `/hetja` is calm: no animation and no loud colour, on an off-white `#fbfbfa` background.
8. Copy has no em dashes. It is warm and dry on marketing pages, and plain on the dog and SOS screens. Use the exact copy from the mocks.

## Design tokens
Put these in `styles/tokens.css` as `:root` custom properties, imported once in the root layout.

### Colour
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#1d1d1f` | Headlines, body text, dark fills, selected states |
| `--secondary` | `#6e6e73` | Supporting text (5.1:1 on white) |
| `--tertiary` | `#86868b` | Placeholders and chevrons only, never body text |
| `--text-mid` | `#48484d` | Muted pill text, badge labels |
| `--hairline` | `#d2d2d7` | Input borders |
| `--divider` | `#e8e8ed` | Row dividers inside cards |
| `--mist` | `#f5f5f7` | App background, inner cards |
| `--white` | `#ffffff` | Cards |
| `--blue` | `#0071e3` | Primary button (pressed: `#0062c4`) |
| `--link` | `#0066cc` | Text links |
| `--blue-tint` | `#e8f1fc` | Tinted "Call" button bg (text `#0062c4`) |
| `--sos` | `#d70015` | SOS button only (pressed: `#b80012`) |
| `--ok-bg` / `--ok` | `#e6f4ea` / `#1a7a35` | Vaccinated, Sterilised, Fed |
| `--warn-bg` / `--warn` | `#fff3e0` / `#9a5200` | Due, Not fed today, Waiting |
| `--neutral-bg` / `--neutral` | `#f2f2f5` / `#48484d` | Unknown, Not sterilised, Last fed |
| `--danger-bg` / `--danger` | `#fde8ea` / `#b80012` | SOS open, Needs a vet now |
| `--aurora-base` | `#fdf6f8` | Aurora page base |
| `--aurora-pink` / `--aurora-peach` / `--aurora-rose` / `--aurora-coral` | `#ffb3dc` / `#ffcbb8` / `#ffc2ec` / `#ffd0c4` | Aurora blobs |
| `--black-band` | `#000000` | Privacy band, with text `#f5f5f7`, support text `#a1a1a6`, link `#2997ff` |
| `--memorial-bg` | `#fbfbfa` | /hetja background, with divider `#e5e5e3` |

**Aurora** is static layered radial gradients over `--aurora-base`. The mobile home recipe is:
```css
background:
  radial-gradient(90% 38% at 0% 0%, #ffb3dc 0%, rgba(255,179,220,0) 70%),
  radial-gradient(80% 30% at 100% 6%, #ffcbb8 0%, rgba(255,203,184,0) 70%),
  radial-gradient(90% 30% at 60% 55%, #ffc2ec 0%, rgba(255,194,236,0) 70%),
  radial-gradient(80% 25% at 0% 90%, #ffd0c4 0%, rgba(255,208,196,0) 70%),
  #fdf6f8;
```
The desktop version uses the same colours with ellipses of about 40% × 60% (see the desktop file). A slow drift animation is optional on the marketing home only, and must respect `prefers-reduced-motion`. Never use it on Scan, Profile, SOS or /hetja.

**Pastel avatar backgrounds** (one per dog, assigned from a hash of the dog id, stable forever), as background / initial colour:
apricot `#ffe3c2` / `#7a4a12`, lilac `#e4defa` / `#4b3a8f`, mint `#d7efe3` / `#1f5c3d`, rose `#ffd9e6` / `#8a2f52`, sky `#dbe9fb` / `#1f4a80`.

### Type
- **Sans:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Roboto, Helvetica, Arial, sans-serif`. No web fonts.
- **Mono** (collar codes, OTP digits): `ui-monospace, "SF Mono", Menlo, "Roboto Mono", monospace`
- **Serif** (/hetja essay only): `"Iowan Old Style", "Palatino Linotype", Georgia, serif`
- Body text uses `-webkit-font-smoothing: antialiased` and `text-wrap: pretty` for paragraphs.

| Style | Size / line-height | Weight | Letter-spacing |
|---|---|---|---|
| Hero display, mobile | 60 / 0.98 | 700 | -0.05em |
| Hero display, desktop | 104 / 0.94 | 700 | -0.055em |
| Section display, desktop | 64–96 / 0.95–1.0 | 700 | -0.05em to -0.055em |
| Page title (mobile marketing) | 40–44 / 1.02 | 700 | -0.04em |
| Screen title (app) | 34 / 1.1 | 700 | -0.03em |
| Dog name | 40 / 1.0 | 700 | -0.035em |
| Card heading | 24 / 1.2 (desktop 30–32) | 700 | -0.025em |
| Lead | 18–19 / 1.42–1.47 (desktop 23 / 1.4), `--secondary` | 400 | 0 |
| Body | 17 / 1.47 | 400 | 0 |
| Row title | 17 | 600 | 0 |
| Row sub | 15 | 400 `--secondary` | 0 |
| Label | 13, uppercase | 600 | +0.06em |
| Big stat | 52 (mobile) / 112 (desktop) / 0.9–1.0 | 700 | -0.05em to -0.06em |
| Collar code, profile | mono 30, 600 | 600 | +0.06em, 14px gap between groups |
| Collar code, input | mono 24 | 400 | +0.12em |
| Minimum reading size | 15 (captions 13) | | |

A "two-tone lead" (grey sentence with a middle clause in ink) is used in hero paragraphs. Build it as a `<span>` with `color: var(--ink)`.

### Spacing, radii, shadows
- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 48, 72. The phone gutter is 20px. Card padding is 24px on mobile and 40–48px on desktop.
- **Radii:** input 16, OTP box 14, inner card 20, card 24–28, desktop card 32, bottom sheet 32 (top corners), pill 999.
- **Shadows:**
  - Primary button: `0 8px 24px rgba(0,113,227,.28)` (hero `0 10px 30px rgba(0,113,227,.32)`)
  - Floating chip: `0 4px 14px rgba(0,0,0,.08)`
  - Floating avatar: `0 12px 30px rgba(0,0,0,.12)`
  - Collar preview card: `0 20px 50px rgba(0,0,0,.12)`
  - Sticky footer divider: `0 -1px 0 #e8e8ed`
- Inputs use an inset ring instead of a border: `box-shadow: inset 0 0 0 1.5px var(--hairline)`, focused `inset 0 0 0 2px var(--blue)`.
- Desktop content width is 1440 frame with 180px side padding (1080 content). Use `max-width: 1080px; margin: 0 auto`.

## Components (build these first, as CSS Modules)
- **Button**
  - `primary`: height 56, radius 999, `--blue`, white 17/600, blue shadow, full width on mobile
  - `sos`: height 60, `--sos`, white 18/700, with a 22px white "!" circle before the label
  - `quiet`: height 44, `#e8e8ed`, ink 15/600
  - `tinted`: height 44–48, `--blue-tint` / `#0062c4`
  - `link`: `--link` 17, with a trailing " ›" where shown
  - `navPill`: height 36, 14/600, blue
  - Pressed state darkens (`#0062c4` / `#b80012`) and uses `transform: scale(.98)`. There's no hover animation on touch. On desktop, hover is the pressed colour. The focus ring is `outline: 3px solid rgba(0,113,227,.45); outline-offset: 2px`.
- **StatusPill**: height 36 (row size 30, small 26–28), padding `0 14px 0 10px`, radius 999, 15/600, 6px gap. Icons are inline SVG at 16px:
  - Check `M3 8.5l3 3 7-7` (stroke 2.2, round)
  - Clock: circle r6 plus `M8 5v3.2l2 1.3`
  - Cross `M4 4l8 8M12 4l-8 8`
  - Alert: a filled circle with "!"
  - Variants are ok, warn, neutral and danger. The icon is required.
- **CollarCode**: display mode splits the code into 3×3 groups in separate spans. Optional "Say it: D D R · zero one seven · X K two" helper, generated from the code. It sits on a `--mist` card with radius 20 and padding 16–22, with a 13 uppercase label "Collar code" above and a "Copy" quiet button on the right.
- **CollarCodeInput**: height 60, radius 16, mono 24. Auto-uppercases for display, inserts visual gaps every 3 characters, and accepts 9 characters from `[a-z0-9]`. Use `inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false"`.
- **Card**: white, radius 28, padding 24. No border on aurora or mist backgrounds. Use a 1px `#e8e8ed` border only if it sits on white.
- **ListRow**: min-height 60–72, 12–14 gap, avatar 44–56, title 17/600, sub 15 secondary, trailing pill or button. 1px `--divider` between rows (not after the last one).
- **DogAvatar**: a circle with the pastel bg. It shows the render image if present, otherwise the initial (700, about 40% of the diameter) in the matching dark colour. Sizes are 36, 44, 56, 104 and 120.
- **TopNav**: height 56 (mobile) / 52 (desktop), `rgba(255,255,255,.6–.72)` + `backdrop-filter: saturate(180%) blur(20px)`, bottom border `rgba(0,0,0,.05)`. Logo on the left: a 30px ink circle with a 5-dot paw, plus "Hetja" 21/700 at -0.02em. Right side: "Sign in" link on mobile. On desktop, links at 13px with 28px gaps.
- **TabBar**: Home / Scan / Me, height 56, `rgba(255,255,255,.92)` with a 1px `#e3e3e8` top border. Labels are 13/600. The active tab is ink with a 22×4 ink bar above; inactive tabs are `--secondary`. Hide it on Scan, SOS, Log feed, Login and Register (focused flows).
- **PrivacyBand**: black, centred, label + 48px (mobile) / 96px (desktop) headline + support text + blue link.
- **Footer**: `--mist`, 15px ink links with min-height 36, then a hairline, then secondary links (In memory of Hetja, Source on GitHub, AGPL-3.0).

## Screens
Numbers match the mock labels. All phone screens are 390 × 844 with the main button pinned at the bottom (`position: sticky; bottom: 0` or a flex column with a scrolling middle area). Respect `env(safe-area-inset-bottom)`.

**01 Home** (`/`): aurora. TopNav, then:
- Hero, centred:
  - Badge pill "Hetja · for Mumbai's street dogs"
  - "Every street has a hero."
  - Lead: "Scan the QR on a dog's collar. See who they are, if they've eaten, and whether they've had their shots. Then carry on with your day, slightly more attached."
  - A row of 5 overlapping 56px avatars (-10px overlap, 3px ring in the base colour)
  - **Scan a collar** (primary), then the link "Or type a collar code ›"
  - A phone mockup (270 wide, 9px ink bezel, cropped at the bottom) showing a mini dog profile
- On `--mist`:
  - "Today in Mumbai" stats card (412 dogs with collars / 1,086 feeds logged, and "Bruno was fed 3 times today. He will tell you it was zero.")
  - "Three steps. No app to install." with three numbered cards
  - "For the people who already show up." with the Feeders streak card and the Vets locked-record card
- PrivacyBand "Ward, not street.", then Footer, then TabBar.

**02 Scan** (`/scan`): dark `#111` full screen.
- The camera feed fills the middle, with a 250px square frame of four white corner brackets (5px stroke, 22px radius).
- "Point at the QR on the collar." 20/600 white, then "It opens by itself. No button needed." 15 `#c7c7cc`.
- A white bottom sheet (radius 32 top) with "No camera, or the QR is muddy?", the CollarCodeInput, and **View profile**.
- "‹ Home" back link and a "Torch" toggle top right.
- On a successful decode, navigate straight to the profile. If camera permission is denied, hide the frame and focus the input.

**03 Dog profile** (`/d/[code]`): white, server-rendered, no client JS needed except the SOS link.
- Photo 210 tall, radius 28
- Name 40, then the ward line
- Pills: Vaccinated, Sterilised, "Last fed 2 hours ago" (neutral, clock icon)
- CollarCode card with Copy
- Story 17/1.47, then "Written by his 3 feeders" 15 secondary
- Sticky footer: **This dog needs help** (SOS), then the caption "Alerts his feeders and a vet nearby."

For unknown status, use the neutral pill with the words "Vaccination unknown". Never leave it blank.

**04 SOS step 1** (`/d/[code]/sos`):
- Back "‹ Bruno"
- "How bad is it?", then "Pick the closest one. You can add details after."
- Three radio cards (min-height 84, radius 20):
  - "Hurt, but moving" / "Limping, a wound, not eating"
  - "Can't get up, or bleeding" / "Needs a vet now"
  - "Something else" / "Missing, scared, or being harmed"
- Unselected cards have an inset 1.5px `#d2d2d7` ring and an empty 26px circle. Selected cards have an inset 3px ink ring, a `--mist` bg and a filled ink circle with a check.
- Optional row "+ Add a photo or a note (optional)".
- Footer caption "Shares K/W ward with feeders. Never your exact spot.", then **Send SOS** (SOS red). The button is disabled until a severity is picked.

**05 SOS sent**:
- Green check circle (52px), "SOS sent.", then "3 of Bruno's feeders and 1 vet have been told. If you can, stay nearby until someone arrives."
- Pills: danger "Needs a vet now" (reflects the chosen severity) and warn "Waiting for reply" (becomes ok "On the way" when someone accepts).
- "Call now" label, then rows (vet / NGO / feeder) with a name, "type · ward · note", and a tinted **Call** button (`tel:` link, 48 tall).
- Footer link "Back to Bruno".

**06 Log a feed** (`/feed?dog=`): mist background.
- "Cancel", then "Log a feed"
- Dog card (56 avatar, name 19/600, mono code 15, "Change" link)
- Optional photo area 170 tall, radius 24
- "How did it go? (optional)" chips, 44 tall: "Ate it all", "Ate a little", "Didn't eat", "Looks unwell". The selected chip is an ink fill with a check.
- Caption "Keeps your streak at 24 days.", then **Log feed**.

If they pick "Looks unwell", show a quiet suggestion to raise an SOS. Don't auto-trigger one.

**07 Login** (`/login`): light aurora.
- "Sign in.<br>No password." 44
- Lead "For feeders and vets. We email you a 6-digit code. You have enough to remember, like which dog hates the red scooter."
- Email field (label "Email"), then **Send code**.

**08 Login code**:
- "‹ Change email", then "Check your email.", then "6 digits sent to {email}. It works for 10 minutes."
- 6 boxes (grid, 8 gap, 64 tall, mono 30/600). The active box has a blue 2px ring and a caret. Use a single hidden input with `autocomplete="one-time-code" inputmode="numeric"`.
- "Nothing yet? Resend in 0:24" countdown, then **Verify**. Auto-submit when 6 digits are entered.

**09 Me** (`/me`): mist background.
- "Morning, Priya." (time-aware: Morning / Afternoon / Evening)
- Streak card:
  - "23" (56/700) + "day streak"
  - "Fed someone every day since 1 September. Bruno still says you missed Tuesday."
  - 4 badges (44 circles plus 12px labels). Locked badges have an outline ring and "N days to go".
- Trust card: "Trusted feeder · Level 2" and "Level 3 at 50", with an 8px progress bar (ink fill on `#e8e8ed`).
- "My dogs" label, then rows with a last-fed pill. Show dogs not fed today first, with the warn pill.
- **Scan to log {first unfed dog}'s feed** above the TabBar.

**10 Register a dog** (`/register`): mist background.
- "Cancel", then "New dog"
- 104 circle photo + helper "A clear face photo. Strangers use it to check they found the right dog."
- Grouped form card:
  - Name
  - Ward (picker, shown as "K/W · Andheri West" with ›)
  - Vaccinated toggle
  - Sterilised toggle (the on state is `--ok` green, but the label text carries the meaning)
- Caption "Only the ward is ever shown. Vets can confirm medical status later."
- **Save & print collar**

**11 Collar ready**:
- "{Name} has a code.", then "Print it on waterproof paper, laminate it, and loop it on a soft collar. Not too tight: two fingers under."
- Preview tag: 250 wide white card, radius 28, with a 170px QR, the mono 26 code, and "{Name} · Scan me if I look lost".
- **Print collar** (`window.print()` with a print stylesheet that shows only the tag), then the link "Save as PDF".

**12 About, 13 How it works, 14 FAQ, 15 Privacy, 16 Contact**: reading pages. See the Pages file for exact copy.
- About and FAQ use the aurora header then mist. How it works is white. Privacy is fully black. Contact is aurora.
- The FAQ uses category chips (Feeders / Vets / Everyone) and accordion rows (min-height 60, +/– toggle, answer 16/1.47 `#48484d`). Use `<details>`/`<summary>`.

**17 /hetja**: `--memorial-bg`.
- Muted nav in `#48484d`
- Centred "Hetja" 64/600, "/ˈhɛtja/  Icelandic, noun", serif italic "hero", then "no tag · no name · 3 km of road" 14 secondary
- Essay in serif 19/1.6 with a 22px paragraph gap, heading "In memory of Hetja" sans 30/600
- "Three songs" list rows

No aurora, blue, red or animation here. Keep the existing essay text unchanged.

**18 Landing, desktop** (≥1024px):
- Frosted nav, then a two-column hero (text left; phone mockup 300×620 right with 5 floating avatars and caption chips)
- Headline 104
- Primary **Scan a collar** + link "Become a feeder ›"
- Mist section: 3-column steps, then a 1.2fr / 1fr bento (stats card with 112px numbers; streak and vet cards stacked)
- Privacy band 96px headline, then a one-line footer

Breakpoints: 390 base, 744 (2-column cards), 1024 (desktop hero).

## Interactions and state
- **Scan:** use the camera through the `BarcodeDetector` API where available, with a lazily loaded small JS decoder as fallback, loaded only on `/scan`. Resolve the code, then `router.push('/d/'+code)`. For an invalid code, show an inline error under the input: "No dog with that code. Check the letters and try again."
- **SOS:** `{ severity: 'moving'|'urgent'|'other', note?, photo? }`, posted to the API. The response returns contacts. No account is needed. Rate-limit per device.
- **Feed:** `{ dogId, outcome?, photo? }`. Optimistic UI, then a brief toast "Logged. Bruno is thrilled, in his own way." Update the streak.
- **Auth:** email, then a 6-digit OTP (10 min expiry, 30 s resend cooldown).
- **Me:** streak, badges, trust level and progress, and dogs with `lastFedAt`.
- **Register:** creates a dog, returns the generated code, then goes to Collar ready.
- **Motion:** none on app screens beyond the native press state. Marketing pages may fade in sections (opacity plus 12px translate, 400ms ease-out), off with `prefers-reduced-motion`.

## Assets
- **Logo:** a 30px ink circle with a white paw made of 5 ellipses (see the nav markup). Replace it with the repo's existing paw icon if there is one.
- **Icons:** inline SVGs (check, clock, cross), listed under StatusPill. No icon font.
- **3D dog avatars:** not produced. The brief asks for friendly 3D busts of Indian indie dogs on the pastel circles. Until they exist, use the initial fallback.
- **Dog photos:** user uploads. Compress them on upload (WebP, max 1080px wide, about 80KB) for slow 4G.

## Files
- `Hetja Design System.dc.html`: tokens and components
- `Hetja Mobile App.dc.html`: screens 02–11
- `Hetja Mobile Pages.dc.html`: screens 01, 12–17
- `Hetja Desktop Landing.dc.html`: screen 18
- `support.js`, `image-slot.js`: only needed to open the mocks in a browser

---
Kept in the repo as the reference for design v4. The `.jpg` boards are renders of
the `.dc.html` mocks. To open the mocks themselves, put `support.js` and
`image-slot.js` from the original Claude Design zip next to them (they are
Claude Design's viewer scripts and are not committed).
