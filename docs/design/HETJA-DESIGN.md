# Hetja — Design System v2

This replaces the v1 doc (cream/forest/amber, Fraunces + Nunito Sans). That
system is gone from `apps/web`. This one is shared with `apps/scan`.

## Authority

**`packages/design/tokens.css` is the single source of truth for every value
in this system.** This document explains the *rationale* for those values and
how they compose into components and pages — it does not restate the hex
codes, pixel sizes, or durations. If a number here and a number in
`tokens.css` ever disagree, `tokens.css` wins; treat the disagreement as a bug
in this file.

Two surfaces consume the same tokens file:

- `apps/web/app/globals.css` — `@import`s it directly.
- `apps/scan` — inlines it into `index.html` at build time (no second
  stylesheet request is affordable on the &lt;40 KB hot path).

If you need a value that isn't in `tokens.css`, that's a gap to report
upstream — never invent a new colour, size, radius, or duration locally.

## Direction: Swiss wayfinding, not editorial minimalism

The references are Otl Aicher's Munich 1972 Olympics signage and Massimo
Vignelli's NYC subway diagram, not a design-blog "clean and minimal" look.
The two are easy to confuse and they solve different problems.

A stranger scanning a collar on a Mumbai street, at night, possibly under
stress, is not browsing — they are navigating an unfamiliar system and need
to make exactly one decision correctly. That is a signage problem:

- **Fixed vocabulary.** Six type sizes, six colours, one radius value (plus
  one exception). No page invents its own scale.
- **One decision per surface.** The dog profile has one primary action, not
  three competing ones (see below).
- **Information ranked by consequence, not by decoration.** Structure comes
  from division — hairline rules — rather than elevation. There are no
  drop-shadow cards left anywhere in `apps/web`; a line does the job a shadow
  used to.
- **Radii collapse to 0.** The old 8/16/24/pill scale suggested friendliness;
  the new scale suggests a printed sign. The one exception,
  `--h-radius-fill` (2px), exists only so a large accent fill doesn't read as
  a printing error — it is not a "rounded corners, but smaller" escape hatch.

## Colour and measured contrast

Six values, defined once in `tokens.css`: a base white, two ink tones, one
hairline grey, one accent, and one "safe" green for verified/vaccinated
states. Every text-on-white pairing was measured, not eyeballed:

| Token | Ratio on white | Meets |
|---|---|---|
| `--h-ink` | ≈ 18.9:1 | AAA at every size |
| `--h-ink-muted` | ≈ 7.0:1 | AAA normal text |
| `--h-accent` | ≈ 6.2:1 | AA normal, AAA large |
| `--h-safe` | ≈ 6.4:1 | AA normal, AAA large |

WCAG 2.2 AA needs 4.5:1 for normal text and 3:1 for large text; AAA needs
7:1 and 4.5:1. Every pairing above clears AA with margin, and the two ink
tones clear AAA.

**The accent is spent on exactly one element per screen.** It is not a
general-purpose "brand colour" to sprinkle on links and icons — it marks the
one thing on a given screen that the user should do. Per **WCAG 2.2 SC
1.4.1**, urgency is never carried by colour alone: everywhere the accent
appears as a call to action, it is paired with an icon *and* an explicit verb
("This dog needs help", not a red button with no label), so the action still
reads as primary with the hue removed. Verify this by hand: set `--h-accent`
to `--h-ink-muted` in devtools and confirm the primary action on `/dog/[slug]`
is still identifiable from icon, label, and position alone.

`--h-safe` follows the same discipline on a smaller scale — vaccinated/ABC
status rows pair a ✓ glyph with a text label, never a bare colour dot.

## Type

Inter, self-hosted, variable, subset to Latin + the weight range the scale
actually uses (400–600). No Google Fonts request, no CDN round-trip. The
subset shipped by `apps/web` is **71,816 bytes** (≈70 KB) — see
`apps/web/public/fonts/Inter-latin-400-600.woff2`, declared in `globals.css`
with `font-display: swap` and a Latin `unicode-range`. `apps/web` sits behind
auth and is not the 40 KB-budgeted hot path (`apps/scan` is, and ships its own
much smaller subset separately) — a webfont is acceptable here, but it is
still one file, one family, and a deliberately small slice of the typeface.

**Exactly six sizes, no intermediate values anywhere:**

`--h-t-plate` (32) → `--h-t-xl` (24) → `--h-t-lg` (17) → `--h-t-md` (15) →
`--h-t-sm` (13) → `--h-t-xs` (11).

No `clamp()`, no fluid type, no one-off pixel value in a `.module.css` file.
If a heading looks like it needs 34px, it gets 32 or 24 — the discipline of a
fixed vocabulary is the point, not a limitation to work around.

`--h-t-plate` is described in `tokens.css` as "the collar code — the
signature element," and it is the largest size specifically because the
collar code is the one thing a caller reads aloud to an NGO over the phone.
Reused elsewhere (page titles, the `/hetja` masthead, a stat number) it still
means "the most important string on this screen."

**Tabular figures** (`--h-num-tabular`, i.e. `font-variant-numeric:
tabular-nums`) are applied to every number a person compares, reads aloud, or
watches count up: the collar plate, dates, distances, trust scores, and
streak-day counts. Proportional figures jitter when they update or align
badly in a column; tabular figures don't.

## Space and geometry

4px base, 8px rhythm, a 20px gutter (`--h-gutter`) sized so a 48px target
plus gutters still fits inside a 320px viewport. Hairline rules
(`--h-hairline`, 1px, colour `--h-rule`) replace both cards and shadows —
division, not elevation. `--h-radius` is 0 everywhere except large accent
fills, which get `--h-radius-fill` (2px).

## Motion

Only `transform` and `opacity` are ever animated (`@keyframes`), matching the
existing 60fps discipline: the target user may be on a hot phone with a
patchy 4G connection, and layout-thrashing animation is latency they pay for.
`prefers-reduced-motion: reduce` collapses `--h-dur` to `0ms` at the token
layer, so every component that reads the variable is reduced-motion-safe for
free. `content-visibility: auto` still defers below-the-fold sections
(stats/band/footer on the landing page).

## The signature element: the collar plate

`.h-plate` (in `globals.css`) is the one reusable piece of "signage type" in
the system: `--h-t-plate`, tabular figures, wide letter-spacing, a hairline
rule above and below, no fill, no radius. It renders the collar code on
`/dog/[slug]` (via `DogCard`) and, inverted, the *absence* of one on `/hetja`
— same hairlines, same height, same tracking, deliberately empty. Don't
introduce a second "big number" treatment; reuse `.h-plate`.

## The one-primary-action rule (scan + dog surfaces)

This is the rule the whole redesign of `/dog/[slug]` exists to enforce. The
surface a QR code opens is not a place to browse — Hoober's field study
(n=1,333) found roughly three-quarters of touch interaction is thumb-driven,
and a stranger under stress should be offered one decision, not four.

Before: a fixed bar with `Feed` and `SOS` at equal visual weight, plus a
3-link header nav, a 3-item bottom nav, and an install banner all competing
for the same screen.

Now:

- **One primary action**, full-width, accent-filled, `--h-radius-fill`,
  ≥48px tall, pinned to the bottom third of the viewport: an icon *and* the
  explicit verb "This dog needs help" (never colour alone — see SC 1.4.1
  above).
- **`Log a feed` is a plain muted text link**, not a button. Feeders are
  repeat users who already know to look for it; a first-time stranger must
  never be asked to choose between two buttons of equal weight.
- **Medical history and stories sit behind a quiet `Full record`
  disclosure** (a native `<details>`, collapsed by default). They used to
  render unbounded and untruncated on every load; now they only exist once
  someone deliberately asks.
- **The global chrome is suppressed on this route only.** `Header`,
  `BottomNav`, and `InstallBanner` are all rendered by a small client
  component, `components/ChromeShell.tsx`, which checks the current pathname
  and renders none of the three for any `/dog/*` route. `Footer` is
  deliberately kept — it sits below all page content and never competes with
  the action in the bottom third. This is the one place in `apps/web` that
  suppresses global chrome; every other route is unaffected.

The same rule (`apps/scan`'s panel) is out of scope for this document — see
`docs/PLAN-v2.md` §3.5 for the hot-path budget it has to live inside instead.

## Components (apps/web)

- **`.h-btn` / `.h-btn-primary` / `.h-btn-dark` / `.h-btn-ghost`** — flat,
  0-radius (primary gets `--h-radius-fill`), min-height `--h-target` (48px).
  Primary is the only accent-filled variant; dark/ghost are ink-outlined, used
  for secondary actions on the same screen so the accent stays singular.
- **`.h-card`** — a hairline border. No background tint, no shadow.
- **`.h-pill` / `.h-pill-amber`** — despite the legacy modifier name (kept so
  no call site needed touching), this renders as an uppercase, tracked,
  ink-muted eyebrow label — never a filled, coloured chip. Structure comes
  from type, not from a badge shape.
- **`.h-header` / `.h-footer`** — white, one hairline (bottom / top
  respectively), no dark fill. `Footer` carries a second, quieter row
  (`.h-footer-legal`, set at `--h-t-xs`) with the memorial link, the AGPL
  source link, and the licence — deliberately stiller than the product nav
  above it.
- **`BottomNav`** — white, hairline top border, active item marked with a
  2px ink top-border rather than a filled pill.
- **`StreakBadge`** — hairline-bordered box; streak days and trust score are
  tabular.
- **Status rows (`DogCard`)** — a ✓ glyph (in `--h-safe`) plus a text label
  ("Vaccinated · Rabies", "ABC done") on its own line. No coloured pill fills.

## Pages

1. **Landing `/`** — white hero, one accent CTA ("Scan a collar"), one
   ink-outlined secondary CTA ("Become a feeder"). Stats strip is three
   tabular numbers divided by hairlines, not a dark band. "How it works"
   steps are a hairline grid, not shadowed cards.
2. **`/dog/[slug]`** — see "the one-primary-action rule" above.
3. **`/hetja`** — a memorial, not a utility screen; see below.
4. **`/login`, `/me`** — plain hairline-bordered forms/panels; trust score
   and streak counts are tabular.
5. **`/about`, `/contact`, `/faq`, `/how-it-works`, `/privacy`** — the content
   pages (`components/Content.module.css`). Same six-size type scale, hairline
   cards, no colour-coded access tiers (`/privacy`'s tier scopes are text
   labels now, per the "never colour alone" discipline, not tinted pills).
6. **`/scan`** — camera-hint + code entry; the camera-hint circle is a
   hairline box, not an amber-filled one.

## `/hetja` — the one deliberate departure

`/hetja` is a memorial for the dog the product is named for, linked from the
footer ("In memory of Hetja") and from `/about`. It is not in the bottom nav —
it isn't a utility surface. Three rules specific to this page, on top of the
shared token system:

- **No accent anywhere.** `--h-accent` is the emergency colour; grief is not
  an alert. The page uses `--h-ink` and `--h-ink-muted` only.
- **The empty plate.** Hetja never had a collar, so `.h-plate` renders with
  no content at all — same hairlines, same height, same tracking as every
  other dog's plate, and nothing between the rules. No dash, no ellipsis, no
  placeholder glyph.
- **Long-form measure.** The only page that departs from the app's tight
  utility width: a single centred column, 66ch max, 1.65 leading, body at
  `--h-t-md`. The seven "Why…" sections are facets of one argument and are
  deliberately not numbered.

## PWA

`manifest.webmanifest` and `viewport.themeColor` (in `layout.tsx`) both moved
from the old forest green to white (`--h-base`), matching the rest of the
system — a green status bar over a white app would be the one remaining trace
of the old identity. `applicationName`/`appleWebApp.title` read "Hetja", not
"StrayNet Feeder" — that was the working name and it had leaked into
user-visible strings (the home-screen label, the install banner, an error
message). It's been swept from every string a user can see in `apps/web`;
`@straynet/*` package names and `straynet-*` systemd units are a separate,
repo-wide concern and were left alone.

## Accessibility — non-negotiable

- **Every interactive target ≥48px** (`--h-target`). Apple HIG calls for
  44×44pt, Material for 48×48dp; WCAG 2.2 SC 2.5.8's 24×24 CSS px is a legal
  floor, not something to design down to. `--h-target-min` (44px) exists only
  for the rare case a 48px box genuinely won't fit.
- **Visible keyboard focus on every control** — a global `:focus-visible`
  rule (2px solid `--h-ink`, 2px offset) covers links, buttons, inputs,
  textareas, and `<summary>`. Nothing suppresses the outline.
- **`prefers-reduced-motion: reduce`** collapses all animation durations to
  ~0 at the token layer.
- **Colour is never the only signal.** Verified/vaccinated status pairs a ✓
  glyph with a label; the primary action pairs an accent fill with an icon
  and a verb; free/paid provider labels (future `/scan` care-directory work)
  are text, not swatches.

## What this document is not

It does not duplicate `packages/design/tokens.css`'s values, and it does not
cover `apps/scan`'s panel/sheet UI or the care-directory work — those live in
`docs/PLAN-v2.md` §2–§3.5 and will get their own pass once built.
