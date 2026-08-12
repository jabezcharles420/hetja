# Hetja — Design System v1

**Hetja** (Icelandic: *hero*) — "The heroes of Mumbai's streets."
The feeders, vets, and neighbours who show up for stray dogs are the product.

## Mood (one sentence)
Warm civic optimism: streetlight amber glowing on deep forest green, cream
paper, big friendly serif headlines, rounded corners, small honest details.

## Tokens (CSS custom properties — components never hardcode values)

```css
:root {
  /* color */
  --h-forest: #1b3a2f;        /* primary dark — header, footer, dark sections */
  --h-forest-soft: #2c5244;   /* hover / secondary surfaces */
  --h-moss: #6b8f71;          /* quiet accents */
  --h-amber: #f2a33c;         /* ACCENT — streetlight. CTAs, highlights */
  --h-amber-soft: #ffe3b3;    /* amber tint — pills, hovers */
  --h-cream: #faf6ee;         /* paper background */
  --h-cream-dark: #efe7d8;    /* raised surfaces on cream */
  --h-ink: #1f2a25;           /* warm near-black — NEVER pure black */
  --h-ink-soft: #5c6b63;      /* secondary text */
  --h-white: #ffffff;
  --h-mint: #5fbf8e;          /* feed/success */
  --h-coral: #e0664d;         /* SOS/emergency */
  --h-coral-soft: #fbe0d9;

  /* type */
  --h-font-display: "Fraunces", Georgia, serif;      /* personality */
  --h-font-body: "Nunito Sans", system-ui, sans-serif; /* friendly, readable */

  /* space (4-based) */
  --h-s1: 4px; --h-s2: 8px; --h-s3: 12px; --h-s4: 16px;
  --h-s5: 24px; --h-s6: 32px; --h-s7: 48px; --h-s8: 64px;

  /* radius */
  --h-r-sm: 8px; --h-r-md: 16px; --h-r-lg: 24px; --h-r-pill: 999px;

  /* shadow — two layers, soft */
  --h-shadow-sm: 0 1px 2px rgb(31 42 37 / .06), 0 2px 8px rgb(31 42 37 / .06);
  --h-shadow-md: 0 2px 4px rgb(31 42 37 / .06), 0 12px 28px rgb(31 42 37 / .10);
  --h-shadow-lg: 0 4px 8px rgb(31 42 37 / .08), 0 24px 56px rgb(31 42 37 / .16);
}
```

Fonts via `next/font/google`: **Fraunces** (display, weights 500/600/700) +
**Nunito Sans** (body, 400/600/800). Prefer `variable` exports; zero layout
shift.

## Components
- **Button** — pill (999), 14px/600 uppercase-tracking, padding 14px 28px,
  min touch target 48px. Variants: primary (amber bg, ink text, hover lift),
  dark (forest bg, cream text), sos (coral bg, white), ghost (cream border).
  Focus ring: 3px amber-soft outline offset 2.
- **Card** — cream-dark bg on cream (or white on forest), radius 16, shadow-md,
  hover: translateY(-2px) + shadow-lg, 200ms ease.
- **Pill/status** — radius 999, 12px/700; variants: verified (mint tint),
  abc-done (moss), pending (amber-soft), lost (coral-soft).
- **Header** — forest bg, cream text; logo = paw glyph in amber circle +
  wordmark "Hetja" in Fraunces; links quiet; sticky.
- **Sticky bottom action bar** (mobile, dog page): Feed (mint, flex-1) +
  SOS (coral, flex-1), safe-area padding.
- **Empty/loading states** — illustrated (inline SVG paw/footprint), never a
  bare spinner alone; skeleton shimmer on profile load.

## Pages
1. **Landing /** — hero: kicker pill ("Mumbai's street heroes"), Fraunces
   64px/1.05 "Every street has a hero.", sub in ink-soft, two CTAs (Scan a
   collar / Become a feeder), paw illustration (inline SVG, amber on forest
   panel). Stats strip (dogs tracked · feeds logged · lives touched — real
   numbers from API later, honest placeholders now). How it works: 3 steps
   (Scan → See → Act). CTA band (forest bg, cream, big Fraunces).
2. **Dog profile /dog/[slug]** — big rounded photo card (or paw placeholder),
   name (Fraunces 40px) + ward pill, status pills (ABC/vaccinated), medical
   strip (verified records only), micro-story card. Sticky bottom bar.
3. **Login /login** — split: brand panel (forest, quote) + OTP form on cream.
   Dev mode shows the code (per backend dev OTP).
4. **Me /me** — header with streak flame + streak_days, badges grid (earned
   vs locked — 40% opacity locked), trust score as a small ring/bar.

## Motion
- Hero: fade-up 400ms ease-out on load.
- Cards: hover lift only (no entrance animation spam).
- Respect `prefers-reduced-motion`.

## PWA
- Manifest: name "Hetja", short_name "Hetja", theme_color #1b3a2f,
  background_color #faf6ee, display standalone, icon = paw on amber (SVG).
- Service worker stays: shell cache + network-first medical fetches.

## Non-negotiables
- WCAG AA contrast on all body text; focus rings visible.
- No pure black anywhere. No centered-on-white default look.
- Every page has a hero moment; nothing feels like a template.
