# Hetja Design System

Hetja (Icelandic for *hero*) is open-source, city-scale infrastructure for keeping Mumbai's street dogs alive: a QR collar tag, a public collar page that opens on any phone with no install, a ward-level SOS network, a ward map of Mumbai, and a tamper-evident medical ledger. It is named after a stray who walked three kilometres through the rain behind a frightened child and was later poisoned, untagged and unrecorded.

**Mission line:** "No stray sleeps hungry, lives in untreated pain, or dies without emergency care."

## Sources

- GitHub: https://github.com/jabezcharles420/hetja (branch `main`). Explore it further for anything not captured here; the handoffs are the ground truth.
  - `packages/design/tokens.css`: every token value (copied verbatim into `tokens/`).
  - `apps/web/components/ds/`: the React component library this system recreates.
  - `apps/scan/index.html`: the framework-free collar page + SOS (inline CSS).
  - `docs/design/HETJA-DESIGN.md`: rules and rationale. `docs/design/v4-handoff/` (spec, mocks, `COPY_DECK.txt`, rendered boards), `v5-handoff/`, `v6-handoff/`, `v7-portals/`.
- Rendered v4 boards are copied to `assets/reference/` for orientation.

## Products / surfaces

- **Collar page + SOS** (`apps/scan`, `/d/<code>`): what a stranger sees after scanning. Plain white, under 40 KB, no framework, no animation.
- **Web app / PWA** (`apps/web`, Next.js): four tabs Home, Map, Scan, Me; feed logging, sign-in, register & print a tag, settings, alerts, the ward map.
- **Marketing & reading pages**: Home, About, How it works, FAQ, Privacy, Contact (aurora + jokes), and `/hetja`, the calm memorial.
- **Portals (v7)**: Vet and NGO (phone screens; the main button is black), Admin (the only desktop layout, 232px sidebar + list-with-detail).
- Desktop above 744px shows an invitation: "Hetja lives on your phone." with a QR.

## Index

- `styles.css`: entry point (imports only). `tokens/colors.css`, `typography.css`, `spacing.css`, `fonts.css`, `base.css`, `components.css` (component classes `.hc-*`, ported 1:1 from the CSS Modules).
- `fonts/`: Inter variable Latin (OFL). `assets/`: `logo-mark.svg`, `icon.svg` (app icon), `reference/*.jpg` (v4 boards).
- `guidelines/`: foundation cards (Colors, Type, Spacing, Brand).
- `components/`: React primitives (see below), one card per folder.
- `ui_kits/app/`: click-through phone app recreation (Home, Scan, Profile, SOS, Sign in, Me).
- `SKILL.md`: Agent Skill entry. `github.md`: source sync record.

## Components

- core: **Button**, **StatusPill** (+ StatusIcon), **Label**, **Card**, **DogAvatar**, **Badge**, **Progress**
- collar: **CollarCode**, **CollarCodeInput**
- lists: **ListRow** (+ ListGroup), **SettingsRow** (+ SettingsGroup)
- forms: **Switch**, **Segmented**
- overlays: **Sheet**, **StickyFooter**
- chrome: **Logo** (+ LogoMark), **TopNav**, **AppHeader**, **TabBar** (+ TabIcon), **Footer**, **PrivacyBand**, **Aurora**, **SectionFade**

### Intentional additions
- `Button variant="dark"`: the v7 portal primary (black pill), which the repo implements as local `.btnDark` / `.dark` / `.inkBtn` classes rather than a ds variant.
- `StatusPill variant="vet"`: the "Vet account" pill (tokens `--h-vet-bg` / `--h-vet`), drawn locally in the repo.
- `.hc-field` CSS class: the inset-ring text input used on Sign in / SOS note (inline in the repo's screens; no ds component).
- `Sheet contained`: positions the sheet inside a phone mockup instead of the viewport.

---

## CONTENT FUNDAMENTALS

- **Voice:** warm and dry on marketing pages; plain and short on the dog, Scan and SOS screens; quiet on `/hetja`. Jokes are about dogs, never about the emergency. "Bruno was fed 3 times today. He will tell you it was zero." "Usually about biscuits." "In theory."
- **Person:** "you" for the reader, "we" for Hetja ("We email you a 6-digit code", "We built it for the first one."). The app speaks to feeders by first name: "Morning, Priya."
- **Casing:** sentence case everywhere, headlines end with a full stop ("Every street has a hero.", "SOS sent.", "Ward, not street."). Uppercase only for the 13px Label ("COLLAR CODE", "MY DOGS").
- **Punctuation:** **no em dashes**, ever (CI greps for them). Middle dot `·` separates facts: "K/W ward · Andheri West", "Vet · K/W ward · open till 9 pm". Chevron `›` on text links ("Or type a collar code ›"), `‹` on back links ("‹ Bruno").
- **Every dog by name; feeders by first name only**, never surnames or numbers. "Rani needs help", "Tells Priya, Arjun and a vet nearby." Opted-out feeders are counted, not named.
- **Honesty:** claim nothing the API can't back. Unknown is said ("Vaccination unknown"), never left blank or guessed. Location is always ward-level: "Shares K/W ward with feeders. Never your exact spot."
- **Buttons say what happens:** "Scan a collar", "This dog needs help", "Send SOS", "Send code", "Scan to log Kaali's feed", "Sign with Face ID".
- **Emoji:** none. Unicode used as glyphs: `·`, `›`, `‹`, `✓` ("✓ Vet signed"), `!` inside the SOS circle (drawn as SVG), `+` (NGO/vet hints), `×`.
- **Copy is verbatim** from the handoff copy deck; example data (Bruno, Rani, Priya S., K/W, DDR 017 XK2) is data, not copy.

## VISUAL FOUNDATIONS

- **Overall vibe:** an Apple product-page look for street dogs. Big, tight, bold headlines; system font; ink, grey and white with exactly two loud colours: blue `#0071e3` for doing things, red `#d70015` for SOS only. Portals use black as their primary.
- **Colour rules:** one loud button per screen. Colour never carries meaning alone: every status pill has an icon *and* words. All text pairs pass AA (gated in CI). `--h-tertiary` is placeholders/chevrons only.
- **Type:** `-apple-system` / SF Pro first, Inter on Android, ui-monospace for collar codes, Iowan Old Style only for the `/hetja` essay. Hero 60/0.98 −0.05em (104/0.94 −0.055em desktop); section 40/1.02 −0.04em; dog name 44/1 −0.04em; screen title 34/1.1 −0.03em; body 17/1.47; min reading 15, captions 13. Tracking tightens as size grows.
- **Backgrounds:** white for fast screens (Scan, profile, SOS); mist `#f5f5f7` for app screens; the **aurora** (layered static radial gradients of pink `#ffb3dc`, peach `#ffcbb8`, rose `#ffc2ec`, coral `#ffd0c4` on `#fdf6f8`) on marketing/reading heroes and sign-in only; a pure black **privacy band** once per marketing page; off-white `#fbfbfa` for the memorial. No photos in the chrome, no textures, no patterns. Dog imagery is the dog's own photo or a pastel circle with the initial (3D dog-bust renders were planned but not provided).
- **Cards:** white, radius 28, padding 24, **no border and no shadow** on mist/aurora; 1px `#e8e8ed` inset only when on white. Inner cards mist, radius 20. Desktop cards radius 32, padding 40.
- **Radii:** input 16, OTP 14, inner 20, card 28, desktop card / sheet 32, pill 999 for every button and pill.
- **Shadows:** sparing. Blue glow under the primary button (`0 8px 24px rgba(0,113,227,.28)`); chip `0 4px 14px rgba(0,0,0,.08)`; floating avatar `0 12px 30px rgba(0,0,0,.12)`. Inputs use an **inset 1.5px ring** (`#d2d2d7`), focus ring inset 2px blue; keyboard focus outline 3px blue at 45%, offset 2.
- **Borders/dividers:** 1px `#e8e8ed` between rows, never after the last row.
- **Bars:** top nav 52px, frosted (white 60% on aurora / 72% on white + `saturate(180%) blur(20px)`), turns solid white with a hairline on scroll ("never a blurred smear"). Tab bar 49px + 34px home-indicator, white 96% + blur, filled 24px icons over 11px labels; active = blue. Focused screens get a 52px AppHeader with "‹ Back" or Cancel and no tab bar.
- **Layout:** 20px phone gutter, 1080px desktop content column. Main buttons are full width, pinned in the bottom third (StickyFooter). Pickers and confirms are **bottom sheets**, never centred dialogs. Touch targets ≥ 44px; primary 56, SOS 60.
- **Motion:** app screens have none beyond the press state. Press = darker fill (`#0062c4` / `#b80012`) + `scale(.98)`, 80ms ease-out. Hover (fine pointers only) shows the press colour; quiet/tinted use `brightness(.95)`; links underline. Marketing may fade sections in (opacity + 12px rise, 400ms ease-out) and the home aurora drifts over 40s; both off under reduced motion. Scan, profile, SOS and `/hetja` never animate. No bounces, no skeleton shimmer.
- **Transparency/blur:** only on the nav and tab bar, and the 0.32 black scrim behind sheets.
- **Disabled:** opacity .4 on buttons.

## ICONOGRAPHY

- **No icon font, no third-party icon set.** Hetja draws a tiny set of inline SVGs, all `currentColor`:
  - Status icons, 16×16 (`StatusIcon`): check (stroke 2.2, round), clock, cross, alert (filled circle with a white "!"). Required on every pill.
  - Tab icons, 24×24 filled (`TabIcon`): home, map pin, scan (corner brackets + filled square), alerts bell, vet cross, NGO heart, me.
  - Privacy band lock (filled body, stroked shackle), the SOS "!" circle (22px white circle, red "!").
- Paths are copied verbatim from `apps/web/components/ds/icons.tsx`, `TabBar.tsx` and `PrivacyBand.tsx` into the components here; reuse the components rather than redrawing.
- Unicode glyphs act as icons in text: `›` chevrons (tertiary grey `#86868b` when alone), `‹` back, `·` separators, `+` and `!` in small tinted circles on the signed-out Me screen.
- **No emoji** anywhere. No PNG icons.
- **Logo:** an ink circle with a white paw of five ellipses + "Hetja" wordmark (21/700, −0.02em): `assets/logo-mark.svg` (from `Logo.tsx`) and the app icon `assets/icon.svg` (white-ringed #111 circle, circle-toe paw). The memorial uses the mark muted to `#48484d`.

## Fonts

SF Pro is the primary face. The user uploaded SF Pro Text, Display, Rounded and the variable SF Pro (`fonts/`, wired in `tokens/fonts-sf.css`); the production site still relies on the system copy on Apple devices (Apple licence) and ships **Inter** (variable, Latin, OFL) for Android, also in `fonts/`. Mono (ui-monospace / SF Mono / Menlo / Roboto Mono) and serif (Iowan Old Style / Palatino / Georgia) are system stacks; Roboto Mono and Iowan Old Style files are not included.
