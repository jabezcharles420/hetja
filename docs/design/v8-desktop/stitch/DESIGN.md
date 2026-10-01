---
name: Municipal Stray Network
colors:
  surface: '#fcf8fb'
  surface-dim: '#dcd9dc'
  surface-bright: '#fcf8fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7ea'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#414755'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#717786'
  outline-variant: '#c1c6d7'
  surface-tint: '#005bc1'
  primary: '#0058bc'
  on-primary: '#ffffff'
  primary-container: '#0070eb'
  on-primary-container: '#fefcff'
  inverse-primary: '#adc6ff'
  secondary: '#bc000a'
  on-secondary: '#ffffff'
  secondary-container: '#e2241f'
  on-secondary-container: '#fffbff'
  tertiary: '#006b27'
  on-tertiary: '#ffffff'
  tertiary-container: '#008733'
  on-tertiary-container: '#f7fff2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#ffdad5'
  secondary-fixed-dim: '#ffb4aa'
  on-secondary-fixed: '#410001'
  on-secondary-fixed-variant: '#930005'
  tertiary-fixed: '#72fe88'
  tertiary-fixed-dim: '#53e16f'
  on-tertiary-fixed: '#002107'
  on-tertiary-fixed-variant: '#00531c'
  background: '#fcf8fb'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
  system-amber: '#FF9500'
  canvas-mist: '#F5F5F7'
  surface-white: '#FFFFFF'
  hairline-border: rgba(0, 0, 0, 0.06)
  divider-subtle: '#E8E8ED'
  input-stroke: '#D2D2D7'
  frosted-surface: rgba(255, 255, 255, 0.78)
  tint-blue-fill: '#E8F2FF'
  badge-danger-bg: '#FEECEB'
  badge-amber-bg: '#FFF4E5'
  badge-green-bg: '#E8F8ED'
typography:
  hero-desktop:
    fontFamily: Inter
    fontSize: 84px
    fontWeight: '700'
    lineHeight: 88px
    letterSpacing: -0.04em
  hero-mobile:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 34px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lead:
    fontFamily: Inter
    fontSize: 19px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: -0.005em
  body-base:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-semibold:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: 0em
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.06em
  caption:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  collar-display:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 34px
    letterSpacing: 0.12em
  collar-input:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: 0.08em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 2rem
  margin: 1rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style

This design system delivers Apple Human Interface Guidelines-inspired municipal utility and animal welfare infrastructure. Engineered for high-speed mobile field operations under harsh, high-glare outdoor conditions, it bridges public civic duty with rapid emergency response. The visual tone balances clinical municipal clarity with humane empathy.

### Visual Aesthetic & Movements
- **Apple HIG / iOS Glassmorphism:** Clean translucency via frosted overlays (`backdrop-filter: blur(20px) saturate(180%)`), pure white elevated cards, and hairline borders (`rgba(0, 0, 0, 0.06)`).
- **Atmospheric Aurora:** Public-facing touchpoints feature an organic, delicate pastel blush haze at viewport tops (radial gradients transitioning from soft peach/rose into clean mist), grounding cold civic utility with compassionate community warmth.
- **Surgical Utility:** Once transitioning into operational tasks (collar lookups, SOS dispatch, feeding registries, ward mapping), decorative elements recede. The UI shifts into a high-legibility, thumb-optimized workflow featuring stark white modules, deep neutral text, and high-visibility Apple system status indicators.

## Colors

The color palette employs Apple system hues calibrated against high-contrast light surfaces to preserve immediate optical legibility under direct sunlight.

### Color Tiers & Roles
- **Primary (`#007AFF`)**: The definitive action hue. Applied to primary submission pills, camera scan triggers, and focal interactive paths. Paired with `tint-blue-fill` (`#E8F2FF`) for non-urgent secondary interactive states.
- **Emergency SOS / Needs Help (`#FF3B30`)**: Strict secondary role. Reserved solely for critical distress reports, triage alerts, and SOS indicators. Accompanied by `badge-danger-bg` (`#FEECEB`) for tag backgrounds.
- **Hungry / Alert Warning (`#FF9500`)**: Operational notice for missed feedings, time lapses, and veterinary check intervals. Accompanied by `badge-amber-bg` (`#FFF4E5`).
- **Verified Clinical / Vaccinated (`#34C759`)**: Tertiary hue indicating completed rabies vaccinations, sterilizations, and verified feeder registrations. Paired with `badge-green-bg` (`#E8F8ED`).
- **Neutral Canvas & Typography (`#1D1D1F`)**: Deep ink tone providing optical density across headings, body copy, and iconography. Viewport backgrounds use `canvas-mist` (`#F5F5F7`), with foreground cards resting on pure `#FFFFFF`.

## Typography

The typographic engine emulates native Apple San Francisco proportions through tight negative letter-spacing, authoritative bold weights, and compact vertical cadence. 

- **SF Pro / Inter Stacks:** Used across all interface framing, conversational copy, and numerical stats. Headline tiers (`hero-desktop`, `headline-lg`, `headline-md`) mandate `text-wrap: balance` alongside negative tracking to preserve native iOS structure.
- **Hardware Collar Mono (`JetBrains Mono`):** Dedicated to municipal collar codes, clinic verification hashes, and ward serial numbers. Elevated tracking (`0.08em` to `0.12em`) optimizes fast recognition during low-light street encounters.
- **Labels & Micro-Copy:** Section dividers and municipal category tags utilize uppercase 12px semi-bold or bold styling with open tracking (`0.06em`) for institutional legibility.

## Layout & Spacing

Layouts conform to a 4px/8px rhythmic scale. Interactions are mobile-first and thumb-reachable, supporting one-handed night operations.

### Form Factors & Adaptations
- **Mobile (<768px):** Fluid single-column layout with 16px outer margins. Actions dock to the bottom viewport edge inside a frosted glass floating utility bar.
- **Desktop Inspector & Split-Screen (≥1024px):** Full-bleed interactive GIS map layer serving as the primary backdrop. Floating, elevated iOS-style left inspector panel (`width: clamp(380px, 28vw, 440px)`) houses ward details, list queues, and dog triage cards with independent internal scrolling.
- **Content Max-Width:** Narrative editorial views constrain reading line lengths to 720px, centered within an expansive atmospheric mist canvas.

## Elevation & Depth

Visual hierarchy relies on frosted glassmorphism, surface translucency, and soft directional ambient light rather than artificial dark drop shadows.

### Elevation Levels
- **Level 0 (Canvas Base):** `canvas-mist` (`#F5F5F7`), supplemented at top viewports by a radial gradient wash (`radial-gradient(ellipse at top left, rgba(255, 219, 219, 0.45) 0%, rgba(255, 235, 214, 0.3) 40%, rgba(245, 245, 247, 0) 70%)`).
- **Level 1 (Surface Cards & Panels):** Solid `#FFFFFF` or translucent `frosted-surface` (`rgba(255, 255, 255, 0.78)`) featuring `backdrop-filter: blur(20px) saturate(180%)`. Bordered by a delicate hairline stroke: `box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 4px 20px -2px rgba(0, 0, 0, 0.04)`.
- **Level 2 (Floating Action Bars & Map Overlays):** Frosted pills and desktop inspector sidebars elevated with `0 12px 32px -4px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05)`.
- **Level 3 (Action Button Glows):** Primary buttons use ambient color-tinted glows: `0 8px 20px rgba(0, 122, 255, 0.28)`. SOS buttons use `0 8px 24px rgba(255, 59, 48, 0.32)`.

## Shapes

The geometry reflects iOS continuous curves and rounded shapes, pairing oversized card corners with fully rounded interactive pills.

### Geometry Hierarchy
- **Pills (`rounded-full` / 9999px):** Universal treatment for call-to-action buttons, segmented control selectors, status chips, avatar bubbles, and floating map tags.
- **App Containers & Desktop Cards (`28px` - `32px`):** Used for elevated cards, bottom sheets, phone simulator frames, and the left desktop inspector container.
- **Inner Modules & Grouped Rows (`16px` - `20px`):** Nested information blocks, collar entry panels, and grouped form sections.
- **Form Controls & Inputs (`14px` - `16px`):** Search boxes, collar lookup fields, and select menus.

## Components

### Buttons
- **Primary Action Button:** 52px height (mobile: 56px), full pill radius, `#007AFF` fill with white 16px semibold text. Subtle tinted blue glow. On tap: scales down to `0.98` with an 80ms transition.
- **Emergency SOS Button:** 56px height, full pill radius, `#FF3B30` fill with crisp white 17px bold text and an exclamation circle icon. Tinted red ambient glow.
- **Secondary / Ghost Pill:** 40px height, full pill radius, `rgba(0, 122, 255, 0.1)` background with `#007AFF` bold label.

### Status Badges & Chips
- **Status Pills:** 28px height, full pill radius, 10px horizontal padding, combining a 12px SVG icon with 13px medium typography.
  - *Emergency:* `#FF3B30` ink on `#FEECEB` background.
  - *Not Fed:* `#FF9500` ink on `#FFF4E5` background.
  - *Vaccinated / Sterilised:* `#34C759` ink on `#E8F8ED` background.
- **Interactive Filter Chips:** 36px height, pure white fill with a subtle `rgba(0,0,0,0.08)` border, turning solid `#1D1D1F` with white typography when selected.

### Input Fields & Collar Search
- **Standard Input:** 48px height, 14px radius, white fill with a `1px solid #D2D2D7` outline. Transitions to a 2px `#007AFF` focus ring with soft glow.
- **Collar Code Display & Input:** 64px height, 18px radius, `#F5F5F7` background, centered monospace JetBrains Mono tracking, displaying uppercase hardware ID characters.

### Cards & Grouped Lists
- **Municipal Inspector Card:** Elevated desktop card with 28px corners, frosted glass background, 20px padding, containing list rows partitioned by 1px hairline dividers (`#E8E8ED`). Dividers never extend beneath the terminal list item.
- **Summary Stat Grid:** Multi-column layout with 16px gaps, housing pure white cards with bold stat counters (`28px`), micro status dots, and uppercase metric labels.

### Floating Inspector & Map Overlays
- **Desktop Inspector Sidebar:** Fixed or floating 400px width module with 24px outer margin from viewport bounds, featuring glassmorphism backdrop blur and full vertical scrolling.
- **Map Category Tabs:** Floating horizontal stack of pills centered at the top of the map layer, using high-contrast black and white active/inactive states.