# Hetja — Design System v3 (Apple / Sidehoe direction)

This replaces v2 ("Swiss wayfinding": square corners, hairlines, no shadows,
one red accent, six fixed Inter sizes). v2 in turn replaced v1 (cream/forest/
amber, Fraunces + Nunito Sans). Neither survives in `apps/web` or `apps/scan`.
v3 keeps the v2 token *names*, so every existing `.module.css` restyled by
value; the new names are additions.

## Authority

**`packages/design/tokens.css` is the single source of truth for every value
in this system.** This document explains the *rationale* for those values and
how they compose into components and pages. Where it quotes a number, it does
so only to explain a decision. If a number here and a number in `tokens.css`
ever disagree, `tokens.css` wins, and the disagreement is a bug in this file.

Two surfaces consume the same tokens:

- `apps/web/app/globals.css` `@import`s the file directly.
- `apps/scan/index.html` hand-copies the tokens it uses into its inline
  `:root`. The hot path can't afford a second stylesheet request under the
  40 KB budget (INVARIANT 13). The copy may leave out tokens scan doesn't use,
  but every value it carries must match `tokens.css` exactly. The one
  intended difference is `--h-font`, which is the same stack **minus
  `"Inter"`**, because scan ships no font file.

If you need a value that isn't in `tokens.css`, report the gap upstream. Never
invent a colour, size, radius, shadow or duration locally.

## Direction: an Apple product page for Mumbai's street dogs

The visual reference is [sidehoe.chat](https://www.sidehoe.chat/), which is
built like an Apple.com product page: a frosted sticky nav, a huge two-line
claim in tight bold type, a device that *performs* the product, and then proof
sections (list → bento → dark privacy band → compare → CTA → grey
footnotes). Hetja keeps that rhythm and changes the subject. The phone shows a
dog being fed, the orbiting faces are dogs, and the footnotes are Hetja's
honest caveats ("coarsened to ward level", "medical records are
append-only"). We copied the *visual language and CSS techniques* only.
Sidehoe's code, copy, logo and memoji assets were not copied (see
`docs/CREDITS.md`).

Why the change from v2: v2 treated every surface as signage, and that was right
for the scan panel but made the rest of the product feel like a form. Most of
Hetja's users are repeat feeders and volunteers, not strangers in an emergency,
and the product has to earn a place on their phone next to apps built in
Apple's idiom. v3 brings in that idiom and keeps the two v2 rules that actually
protect people: **one decision per surface** and **never colour alone**.

Principles:

1. **Warm, dry, specific copy.** Use specific dog names, times and wards
   ("Biscuit's rabies shot is due Friday. Biscuit does not know."), never
   generic marketing language.
2. **The device is the demo.** Sections show real UI (a list row, an alert, a
   widget), not illustrations.
3. **One loud thing per screen.** On a marketing page only the hero is loud.
   In the app only the primary action is loud: a blue pill, or red for SOS.
4. **Depth from glass and soft shadow, not borders.** Surfaces stack in a fixed
   order: aurora → grey section (`--h-gray`) → white tile → glass chip.
   Hairlines (`--h-rule`) remain only as list separators and input borders.
5. **Motion that explains.** Things rise in, bubbles pop, the orbit drifts.
   Nothing loops on a working screen (`/dog`, `/scan`, `apps/scan`), and all
   of it switches off under reduced motion.

## Colour and measured contrast

The palette is Apple's system neutrals plus a small set of intent colours:
`--h-accent` (action blue), `--h-link` (text-link blue), `--h-danger` /
`--h-danger-fill` (SOS), `--h-safe` (verified), `--h-warn`, their tinted
backgrounds, the dark-band pair, and four decorative aurora colours.

These figures come from `bash ops/contrast-gate.sh`, which parses `tokens.css`
and fails CI below 4.5:1. They are measured, not estimated:

| Foreground | Background | Ratio | Meets |
|---|---|---|---|
| `--h-ink` | `--h-base` | 16.83:1 | AAA |
| `--h-ink-muted` | `--h-base` | 5.07:1 | AA |
| `--h-accent` | `--h-base` | 4.70:1 | AA |
| `--h-danger` | `--h-base` | 5.38:1 | AA |
| `--h-safe` | `--h-base` | 5.40:1 | AA |
| `--h-warn` | `--h-base` | 4.67:1 | AA |
| `--h-ink` | `--h-gray` | 15.46:1 | AAA |
| `--h-ink-muted` | `--h-gray` | 4.66:1 | AA |
| `--h-link` | `--h-base` | 5.57:1 | AA |
| `--h-link` | `--h-gray` | 5.11:1 | AA |
| `--h-base` (label) | `--h-accent` (fill) | 4.70:1 | AA |
| `--h-on-dark` | `--h-dark` | 19.29:1 | AAA |
| `--h-on-dark-muted` | `--h-dark` | 8.16:1 | AAA |

Pairs the gate deliberately does not list, measured with the same formula:

- **`#0071e3` text on `--h-gray` is 4.31:1, which fails AA.** That is the only
  reason `--h-link` (`#0066cc`) exists. Sidehoe's blue is kept for *fills*
  (the pill button with a white label, 4.70:1), and every blue *text* link
  uses `--h-link`, which passes on both white and grey.
- **`--h-ink-faint` is 3.62:1 on white and 3.33:1 on grey, so it is non-text
  only**: chevrons, the "not confirmed" dash in status rows, placeholder
  strokes. It may also be used for text of 24px or larger, which counts as
  large text. Never use it for body copy or labels.
- **White on `--h-danger-fill` (`#ff3b30`) is 3.55:1.** That passes only as
  large text (at least 18.66px bold), so the SOS label is always
  `--h-t-lg` (19px) and bold. Small red text uses `--h-danger` (`#d70015`),
  never the fill colour.
- `--h-imessage` (`#0a84ff`, 3.65:1 on white) is used for the focus ring and
  bubble fills. A focus ring is non-text, so it only needs 3:1.
- The aurora colours are decorative and never sit behind body text without a
  white or glass tile between them.

**The accent is spent on one element per screen.** It is not a brand colour to
sprinkle on icons. It marks the one thing on a screen the user should do. Per
**WCAG 2.2 SC 1.4.1**, urgency is never carried by colour alone: every primary
action pairs its fill with an icon *and* an explicit verb ("This dog needs
help"). To check this by hand, desaturate the page in devtools and confirm the
primary action on `/dog/[slug]` and `apps/scan` still reads as primary from its
icon, label, size and position.

## Type

**SF first, Inter as the fallback, never a default sans.** The stack in
`--h-font` resolves to SF Pro on Apple devices (`-apple-system`,
`BlinkMacSystemFont`, `"SF Pro Display"`, `"SF Pro Text"`), which is what
Sidehoe uses. Everywhere else it resolves to self-hosted Inter, the closest
openly licensed match to SF's proportions.

- `apps/web` ships **one file**: `apps/web/public/fonts/Inter-latin-var.woff2`
  (48 KB). It is the variable font with the full 100–900 weight axis, Latin
  subset, declared once in `globals.css` with `font-display: swap` and a Latin
  `unicode-range`. It comes from rsms/inter via `@fontsource-variable/inter`
  under OFL-1.1, with the licence at `apps/web/public/fonts/Inter-OFL.txt`.
  There is no Google Fonts request and no CDN round-trip. Apple devices never
  download it.
- `apps/scan` ships **no font**. The file alone is larger than scan's whole
  40 KB budget, so scan uses the same stack minus Inter (0 bytes).

**Display sizes are fluid; UI sizes are fixed.** Marketing headlines use
`clamp()` tokens (`--h-t-hero`, `--h-t-display`, `--h-t-bignum`,
`--h-t-tile`, `--h-t-lede`) with tight negative tracking
(`--h-track-hero` / `--h-track-display`), which is the Apple look. Everything
a person operates uses the fixed UI scale (`--h-t-plate`, `--h-t-xl`,
`--h-t-lg`, `--h-t-md`, `--h-t-sm`, `--h-t-xs`) with `--h-track-body`. A
working screen never uses fluid type, because a button label that grows with
the viewport is a layout bug waiting to happen. Don't use one-off pixel sizes
in a `.module.css`.

**Tabular figures** (`--h-num-tabular`) apply to every number a person
compares, reads aloud or watches count up: the collar plate, dates, distances,
trust scores, streaks and `NumberTicker` values.

## Space and geometry

- **Space:** a 4px base (`--h-s1` to `--h-s9`), a `--h-gutter` of 22px
  (Sidehoe's 44px total inset), and fluid section padding (`--h-section-y`).
- **Radii are a scale, not a single value.** Use `--h-radius-sm` for inner
  rows and nudges, `--h-radius` for controls and small cards, `--h-radius-card`
  for profiles and grouped lists, `--h-radius-tile` for bento tiles and the
  dog photo, and `--h-radius-pill` for buttons, chips and the plate. Bottom
  sheets use iOS's smaller 10–14px top radius. The v2 name `--h-radius-fill`
  now also resolves to a pill.
- **Shadows are soft and few.** `--h-shadow-card` is a long, low-opacity drop
  plus a 1px hairline ring, for tiles and photos. `--h-shadow-float` is for
  sheets, toasts and popovers, `--h-shadow-chip` for glass chips,
  `--h-shadow-cta` for the blue pill, and `--h-shadow-phone` for the device
  frame. Nothing gets a hard, dark or offset shadow.
- **Glass** (`--h-glass`, `--h-glass-strong`, `--h-glass-gray`, `--h-blur`,
  `--h-glass-edge`) is reserved for things that float over content: the
  sticky nav, the tab bar, chips over the aurora, and banners. A glass surface
  never carries body copy over the aurora without enough opacity to hold AA.
- **Targets:** `--h-target` (48px) is the comfortable size and
  `--h-target-min` (44px, Apple HIG) is the floor.

## Motion

- Animate only `transform`, `opacity` and `filter`. The target user may be on a
  hot phone on patchy 4G, and layout-thrashing animation is latency they pay
  for.
- Use `--h-dur` for UI feedback, `--h-dur-slow` for rise-ins, `--h-ease` as the
  standard curve, `--h-ease-out` for entrances and sheets, and `--h-ease-pop`
  for bubbles and badges.
- `prefers-reduced-motion: reduce` sets both durations to `0ms` at the token
  layer. Components that run their own loops (the aurora, `OrbitRing`,
  `Marquee`, `NumberTicker`, `Reveal`, `ScrollStory`) also check the media
  query and render their final, static state. Content is never hidden waiting
  for an animation.
- Nothing loops on a working screen. Ambient motion (aurora, orbit, marquee)
  belongs to marketing surfaces only. The aurora is WebGL with a static CSS
  gradient fallback and is never loaded on `apps/scan`.
- `content-visibility: auto` still defers below-the-fold sections.

## The one-primary-action rule (kept from v2)

This rule survives every restyle. The surface a QR code opens is not a place to
browse: Hoober's field study (n=1,333) found roughly three-quarters of touch
interaction is thumb-driven, and a stranger under stress should be offered one
decision, not four.

- **One primary action per screen**: a full-width pill, at least 48px tall, in
  the bottom third. Use `--h-accent` blue for normal actions and
  `--h-danger-fill` red with a white, bold, large label for SOS or urgent
  actions. It always has an icon *and* a verb.
- **Everything else is quieter.** Secondary actions are `--h-link` text links
  or tinted grey pills (for example, `Log a feed` under "This dog needs help"),
  never a second filled button of equal weight.
- **Detail sits behind a disclosure.** Medical history and stories live behind
  a native `<details>` "Full record" row, collapsed by default.
- **Chrome is suppressed on `/dog/*`.** `components/ChromeShell.tsx` renders no
  `Header`, `BottomNav` or `InstallBanner` there. `Footer` stays because it
  sits below everything.

### `apps/scan` panel

The zero-install page a collar QR opens applies the same rule inside the 40 KB
budget. It uses the system font only and has no aurora, no WebGL and nothing
that loops. From top to bottom:

- A white page with a subtle `--h-gray` band at the top.
- The dog photo at `--h-radius-tile` with `--h-shadow-card`. With no photo,
  the placeholder is the Dogmoji glyph: 🐶 in a pastel gradient circle.
- The name in large bold type with tight tracking, the collar code as a grey
  pill chip with tabular figures, and the ward.
- A grey tile holding an iOS inset grouped list: Vaccinated and Sterilised,
  each with a ✓ in `--h-safe` plus a text label, or a neutral dash plus
  "Unknown". A "Full record" disclosure row follows.
- The red SOS pill ("This dog needs help").
- The `--h-link` text link "Log a feed".

The severity flow opens as an iOS bottom sheet with a grabber, a 14px top
radius, a grey background, white grouped rows with chevrons, and care
providers as white cards with tinted Call and Directions pills. Banners are
rounded glass pills that stick to the top, and the toast is a dark glass card.

## Dogmoji — the character system

Apple's Memoji and Animoji art is Apple IP and can't ship on the web. Hetja uses
**Microsoft Fluent Emoji 3D** instead, which has the same glossy, soft-lit 3D
look under the MIT licence
([microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji)).

- **Assets:** `apps/web/public/dogmoji/*.webp`, pre-sized at 128px and 256px,
  with the licence alongside as `LICENSE-fluentui-emoji.txt`. The set covers
  the dog bases (dog face, dog, poodle, guide dog) and the product props
  (bone, bowl, syringe, pill, adhesive bandage, stethoscope, ambulance,
  hospital, house, camera, bell, fire, trophy, sparkles, heart, lock and
  others).
- **`Dogmoji`** (`components/ui/Dogmoji.tsx` + `lib/dogmoji.ts`) is the port of
  Sidehoe's `.avatar[data-who]` pattern: the sticker inside a pastel gradient
  circle. It resolves in this order: a real photo (a real dog always beats a
  cartoon of one), then the Fluent WebP, then the 🐶 glyph if the image fails.
  A small named cast (Bruno, Biscuit, Kaalu, Moti, Sheru, Rani, Tommy, Laddoo,
  Chikki, Bholu) each has its own gradient pair and an optional accessory
  (collar ring, ✚ medical dot), so the cast doesn't look identical.
- **Drop-in override:** a file at `apps/web/public/dogmoji/custom/<slug>.webp`
  wins over the generic sticker for that dog. That way commissioned or
  generated custom dog memoji can land later with no code change, which is the
  same mechanism Sidehoe uses for its memoji.
- **`apps/scan`** uses the emoji glyph only (0 bytes) in the same gradient
  circle. The WebPs are never shipped on the hot path.
- Dogmoji is decorative by default (`aria-hidden`), because the dog's name is
  always next to it in text.

## Apple element inventory (`apps/web/components/ui`)

These are hand-ported to CSS Modules with no component-library dependency.
Pattern references: Magic UI, Aceternity UI and Konsta UI (see
`docs/CREDITS.md`). Icons are Phosphor path data inlined by `Icon.tsx`, because
SF Symbols is licensed for Apple platforms only. This section describes each
element's *role*. Its props live in the source.

**Core**

| Element | Role |
|---|---|
| `Icon` | Inline-SVG Phosphor icons (regular and fill weights, the closest open match to SF Symbols). No icon font, no dependency. |
| `Dogmoji` | The character avatar described above. |
| `Ambient` | The fixed aurora background (WebGL blobs with a CSS-gradient fallback). Marketing surfaces only. |
| `PhoneFrame` | iPhone mockup with a Dynamic Island that can expand into a "Live Activity" ("Feeding Bruno · 02:14"). The device that performs the demo. |
| `OrbitRing` | Dogmoji faces drifting around the hero phone with glass tags ("Fed 2h ago"); collapses to a facepile on mobile. Decorative (`aria-hidden`). |
| `Reveal` | Blur-fade rise-in on scroll. Under reduced motion, content is shown immediately. |
| `NumberTicker` | Counts up impact numbers. It server-renders the final value, so no JS or reduced motion still shows the truth. |
| `Marquee` | Slow horizontal strip of ward names between landing sections. |
| `Chat` | iMessage-style bubbles and typing dots: the feed log told as a conversation. |
| `StatusPill` | Small tinted status chip (ok / warn / late) that always carries a text label. |

**iOS**

| Element | Role |
|---|---|
| `GroupedList` | iOS Settings inset grouped list with chevrons and hairline separators, used for roster, FAQ, `/me` and dashboards. |
| `SegmentedTabs` | iOS segmented control for `/me` tabs and dashboard filters. |
| `Toggle` | iOS switch for notification and settings toggles and register-form options. A real checkbox underneath. |
| `Sheet` | Bottom sheet with a grabber, for the log-feed flow and the mobile SOS modal. |
| `IOSAlert` | iOS alert and action sheet, for SOS confirmation and the collar-mismatch warning. |
| `NotifStack` | Lock-screen notification stack of glass cards that fan out, for the privacy band and `/me` alerts. |
| `Widget` | iOS home-screen widgets (small: streak; medium: dogs near you plus a map). |
| `ActivityRings` | Fitness-style rings for feeds today, ward coverage and streak. |
| `WalletPass` | Wallet-style collar pass (gradient, Dogmoji, plate, QR), for the dog header and register success. |
| `WardMap` | Maps-style static SVG ward card with a pin and a count ("Dadar West · 14 dogs"). Ward-level only (INVARIANT 2). |
| `LargeTitle` | iOS large-title header that collapses into the glass nav on scroll. |
| `ScrollStory` | Pinned "scrollytelling" phone whose screen changes as the steps scroll past (Scan → See → Act). |
| `Bento` | 12-column bento grid of 28px-radius tiles. |
| `CompareTable` | Compare columns ("Hetja / Hetja for NGOs / Doing nothing"). |
| `HungerSlider` | The interactive toy ("How hungry is Bruno?"): a slider that rewrites a chat bubble. Hetja's analogue of Sidehoe's tone control. |

Global primitives in `globals.css`: `.h-btn` (`-primary` blue pill, `-danger`
red pill, `-dark`/`-ghost` secondary, `-link` text), `.h-chip` / `.h-pill`,
`.h-status-*`, `.h-card`, `.h-tile`, `.h-glass`, `.h-bento`,
`.h-section-{gray,white,dark}`, the display type classes, and `.h-plate`.

## The collar plate

`.h-plate` renders the collar code as a grey pill chip: `--h-gray` fill,
tabular figures, wide tracking, semibold. It is the one reusable
"big code" treatment, used on `/dog/[slug]`, `WalletPass` and `apps/scan`.
Don't introduce a second one. The collar code is the string a caller reads
aloud to an NGO over the phone, so it keeps the largest fixed UI size.

## `/styleguide` (development only)

`apps/web/app/styleguide` renders every token and every element above in one
place, so the look can be signed off before pages change. It is `noindex`,
left out of every nav, and returns 404 in production builds unless
`HETJA_STYLEGUIDE=1` is set.

## `/hetja` — the calm departure

`/hetja` is a memorial for the dog the product is named for, linked from the
footer and from `/about`, and never in the bottom nav. It reuses the black
`.h-section-dark` band (the same band as the privacy section) and deliberately
drops everything else v3 adds:

- **No accent and no red.** `--h-accent` is the action colour and
  `--h-danger-fill` the emergency colour. Grief is neither.
- **No animation.** No aurora, no `Reveal`, no orbit, no ticker. The page is
  still.
- **The empty plate.** Hetja never had a collar, so the plate chip renders with
  nothing in it: the same size as every other dog's plate, with no dash,
  ellipsis or glyph.
- **Long-form measure.** One centred column, about 66ch, generous leading.

## The print sheet (unchanged)

`apps/web/app/(register)/register/[slug]/print/print.module.css` is a physical
collar artefact: it is printed on office printers and laminated. The v3 restyle
deliberately leaves its layout and rules alone. There is no glass, no shadow,
no aurora and no fluid type, and nothing depends on colour. Because it reads
the shared tokens, only token *values* such as ink, accent and the fill radius
reach it. Check a print preview after any token change.

## PWA

`manifest.webmanifest` `theme_color` and `viewport.themeColor` (`layout.tsx`)
are white (`--h-base`). `apps/scan` uses `--h-gray` so the status bar blends
into its grey top band. User-visible strings read "Hetja".

## Accessibility — non-negotiable

- **Every interactive target is at least 48px** (`--h-target`), and
  `--h-target-min` (44px, HIG) only where 48 genuinely won't fit. WCAG 2.2
  SC 2.5.8's 24px is a legal floor, not a design size. This includes glass
  chips, segmented segments, toggles, the sheet close button (visually a 30px
  circle inside a 44px hit area) and every list row.
- **Visible keyboard focus on every control.** A global `:focus-visible` ring
  in `--h-imessage` with an offset covers links, buttons, inputs, `<summary>`
  and `[tabindex]`. Nothing suppresses the outline, including on glass or on
  the blue and red pills.
- **Contrast is gated.** `ops/contrast-gate.sh` runs in CI and fails any
  documented text pair below 4.5:1 (table above). Text on glass over the
  aurora is checked by axe in `e2e/a11y.spec.ts`.
- **Reduced motion.** `prefers-reduced-motion: reduce` zeroes durations at the
  token layer, every looping component renders its static end state, and no
  content waits on an animation to become visible.
- **Colour is never the only signal.** Verified status pairs a ✓ with a label,
  and unconfirmed status shows a dash plus the word. The primary action pairs
  its fill with an icon and a verb. Care-provider tiers ("FREE", "24×7") and
  `StatusPill` states are text.
- **Decoration is hidden from assistive tech.** Dogmoji, the orbit, the aurora
  and marquee duplicates are `aria-hidden`. A photo placeholder that stands
  alone carries a text label.
- **Mobile layout is gated.** `e2e/mobile-layout.spec.ts` asserts no gutter
  loss or horizontal scroll at 390px. The orbit and aurora are clipped
  (`overflow: clip`) so they can't overflow.

## What this document is not

It does not duplicate `packages/design/tokens.css`'s values or any component's
props. It does not specify page copy. It does not cover the care-directory data
model or the SOS routing logic, which live in `docs/PLAN-v2.md` §2–§3.5 and
`docs/HOW-IT-WORKS.md`. Visual decisions only, with the reason for each.
