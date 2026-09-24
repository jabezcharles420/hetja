# Motion kit

Apple product-page motion for Hetja, with no dependencies. Import from `@/components/ui/motion`. You can see every effect at `/styleguide#motion` (`app/styleguide/MotionSection.tsx`).

## Rules for the whole kit

- **Only transform, opacity, filter and clip-path animate.** There are two small, documented exceptions: GradientText sweeps `background-position` over a text-sized box, and the active Gallery dot springs its `width`.
- **The server render is the final state.** No JS, jsdom, a failed hydration and reduced motion all show the content at rest and fully visible. Nothing is hidden by markup, only by a class added after mount or by CSS gated on `prefers-reduced-motion: no-preference`.
- **Reduced motion turns effects off.** Scroll effects render at their end state, loops become static, and the burst becomes a checkmark. `globals.css` also clamps every animation globally.
- **Decorative layers are `aria-hidden`.** Real content keeps its semantics.
- **Nothing loops on `/dog` or `/scan`.** The only motion allowed on those screens is `PawBurst` for feed success (and streak milestones). It answers the user's action and ends within about a second. Every other effect here is for the landing page, marketing pages, `/me` and empty states.

## Effects

| Component | Use it for | Don't use it for |
|---|---|---|
| `ScrollReveal` / `Stagger` | Sections and tile rows rising in (`effect`: rise, clip, scale, fade). Uses a CSS `view()` timeline, with an IntersectionObserver fallback. | Above-the-fold hero copy (use `.h-rise`). Lists the user works through. |
| `HighlightText` | One manifesto paragraph per page, lit word by word as you scroll. Screen readers get the text once. | Body copy, instructions, anything the user must read quickly. |
| `StickyZoom` | The single product moment: a pinned device or photo scaling 1.15 to 1 while its corners round in. | More than once per page. Mobile working screens. |
| `ScrollScrub`, `useScrollProgress`, `useScrollProgressVar` | Custom scroll-linked CSS: `--p` goes from 0 to 1 (`view` or `contain` range). It is rAF-throttled, uses passive listeners, and only listens while on screen. | State that re-renders big trees (`useScrollProgress` re-renders every frame, so prefer the var binder). |
| `GlowBorder` | "Hetja is listening" or AI moments, and the hero CTA. By default it spins for one turn when seen and keeps spinning on hover or focus. | `loop` anywhere without a page pause. `/dog`, `/scan`, SOS. |
| `GradientText` | Hero and section headlines (24px and up). The stops are at least 4.4:1 on white and grey. | Body text, links, buttons. |
| `Gallery` | Story or feature carousels: scroll-snap, dots with an autoplay fill, arrows, keyboard, and a Pause/Play button. | Critical content that only appears in one slide. |
| `Parallax` / `ParallaxLayer` | Stickers and blobs drifting around a device (depth 1 moves 48px on scroll and 12px toward the pointer). | Text layers, or large offsets. |
| `Tilt` | A WalletPass-style card leaning toward the cursor, with a sheen. Fine pointers only. | Touch UIs (it is a no-op there anyway). Lists. |
| `Magnetic` | One primary CTA drifting toward the cursor (10px at most) and springing back. | Rows of buttons, nav links. |
| `TransitionLink`, `useTransitionRouter`, `RouteFade` | Same-document View Transitions for App Router navigations. `RouteFade` goes in a `template.tsx` as the no-API fallback. | Links opened in a new tab (they pass through untouched). |
| `LiquidGlass` | One small floating pill or tab bar. It refracts in Chromium and falls back to frosted blur elsewhere. | Full-width bands, list rows, anything that scrolls under constantly. |
| `PawBurst` | "Feed logged!" and streak milestones. Put it inside a `position: relative` parent and bump `fire`. | Errors, SOS, anything repeated per row. |

Spring tokens live in `packages/design/tokens.css`: `--h-spring` with `--h-dur-spring` (600ms, about 4% overshoot) and `--h-spring-bouncy` with `--h-dur-spring-bouncy` (900ms, about 20% overshoot). Both are sampled `linear()` curves with a cubic-bezier fallback. Always use each curve with its duration token.

## Browser support notes (September 2026)

- **Scroll-driven animations** (`animation-timeline: view()` / `scroll()`) are supported in Chrome 115+ and Safari 26+. Firefox only enables them by default in its newest releases (about 87% global support). That is why every scroll effect here has a JS fallback that writes `--p`. Sources: [caniuse](https://caniuse.com/mdn-css_properties_animation-timeline_view), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations), [Cyd Stumpel](https://cydstumpel.nl/start-using-scroll-driven-animations-today/).
- **Word-by-word highlight** gives each word a slice of one named view timeline. This is the same approach as [Builder.io: view-timeline](https://www.builder.io/blog/view-timeline) and [Dirck Mulder](https://www.dirckmulder.com/blog/scroll-reveal-css). It animates opacity rather than colour so the work stays on the compositor.
- **View Transitions** (same-document `document.startViewTransition`) are supported in Chrome 111+, Safari 18+ and Firefox 144+ (about 92% global support). CSS `@view-transition { navigation: auto }` covers cross-document (MPA) navigations only, so it does nothing for App Router client navigations. Next 14 has no built-in hook for this; React `<ViewTransition>` and `experimental.viewTransition` require Next 15.2+. Sources: [caniuse](https://caniuse.com/view-transitions), [Next.js guide](https://nextjs.org/docs/app/guides/view-transitions), [next.js discussion #46300](https://github.com/vercel/next.js/discussions/46300), [next-view-transitions](https://github.com/shuding/next-view-transitions).
- **`linear()` easing** is supported in Chrome/Edge 113+, Firefox 112+ and Safari 17.2+. Sources: [Chrome for Developers](https://developer.chrome.com/docs/css-ui/css-linear-easing-function), [Josh Comeau](https://www.joshwcomeau.com/animation/linear-timing-function/).
- **Glow border.** Most recreations animate a `@property` angle inside a `conic-gradient`, which repaints every frame. This kit rotates a pre-painted layer instead, which is transform-only. Sources: [css-tip](https://css-tip.com/glowing-border/), [codetv](https://codetv.dev/blog/animated-css-gradient-border).
- **Liquid Glass refraction** (an SVG `feDisplacementMap` used through `backdrop-filter: url()`) only works in Chromium. Safari and Firefox parse the syntax but do not render it, so `@supports` cannot detect support and the upgrade is gated in JS. Rebuilding the displacement map is expensive, so this kit's lens map is static. Sources: [kube.io](https://kube.io/blog/liquid-glass-css-svg/), [LogRocket](https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/).
- **Image-sequence scrubbing (AirPods)** is **not built.** Apple's AirPods sequence is about 65 frames and 15 MB. That cost is wrong for a Mumbai feeder on 4G, and `StickyZoom` plus a single poster image gets most of the effect. Sources: [CSS-Tricks](https://css-tricks.com/lets-make-one-of-those-fancy-scrolling-animations-used-on-apple-product-pages/).
- **WCAG 2.2.2 (Pause, Stop, Hide).** Anything that moves automatically for more than 5 seconds next to other content needs a real pause control. Pause-on-hover alone is not enough. Gallery ships a Pause button, GlowBorder and GradientText stop within 5 seconds by default, and PawBurst lasts about 1 second. Sources: [W3C-based guide](https://www.thewcag.com/criteria/2.2.2), [tabnav](https://tabnav.com/academy/wcag/success-criterion-2.2.2).
