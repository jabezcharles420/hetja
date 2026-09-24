"use client";

import { useState } from "react";
import { CAST } from "@/lib/dogmoji";
import { Dogmoji, PhoneFrame, Sticker, StatusPill } from "@/components/ui";
import type { DogmojiAsset } from "@/lib/dogmoji";
import {
  Gallery,
  GlowBorder,
  GradientText,
  HighlightText,
  LiquidGlass,
  Magnetic,
  Parallax,
  ParallaxLayer,
  PawBurst,
  ScrollReveal,
  ScrollScrub,
  Stagger,
  StickyZoom,
  Tilt,
  TransitionLink,
  type GalleryItem,
} from "@/components/ui/motion";

/**
 * Styleguide: Motion kit. A scroll-through of every effect in the order a
 * landing page would use them, in the Sidehoe section rhythm (white, grey,
 * dark). Scroll slowly: most of these are driven by scroll position, not time.
 * Client component because the paw-burst demo holds state; dev-only route.
 */

const SG_MOTION_CSS = `
.sgm-block { margin-top: clamp(40px, 5vw, 64px); }
.sgm-label { display: block; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--h-ink-muted); letter-spacing: 0; margin-bottom: 14px; text-align: left; }
.h-section-dark .sgm-label { color: var(--h-on-dark-muted); }
.sgm-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 18px 22px; }
.sgm-cta { display: inline-flex; align-items: center; gap: 10px; }
.sgm-tiles { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); text-align: left; }
.sgm-tiles > * { display: flex; }
.sgm-tiles .h-tile { flex: 1; }
.sgm-ward { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sgm-ward b { font-size: var(--h-t-xl); font-weight: var(--h-w-semibold); letter-spacing: -0.02em; }
.sgm-face { display: flex; gap: 6px; }
.sgm-screen { display: flex; flex-direction: column; gap: 14px; padding: 64px 18px 24px; height: 100%; background: var(--h-ios-grouped); text-align: left; }
.sgm-screen-card { background: var(--h-base); border-radius: var(--h-radius-card); padding: 16px; display: flex; align-items: center; gap: 12px; }
.sgm-screen-card b { display: block; font-size: var(--h-t-lg); }
.sgm-screen-card small { color: var(--h-ink-muted); font-size: 13px; }
.sgm-story { height: 100%; min-height: 360px; border-radius: var(--h-radius-tile); padding: 28px; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; text-align: left; background: linear-gradient(160deg, var(--a), var(--b)); color: var(--h-ink); }
.sgm-story h3 { margin: 0; font-size: var(--h-t-tile); line-height: 1.1; letter-spacing: var(--h-track-body); }
.sgm-story p { margin: 0; font-size: var(--h-t-md); line-height: 1.4; }
.sgm-story .h-chip { align-self: flex-start; }
.sgm-scene { position: relative; min-height: 460px; display: grid; place-items: center; }
.sgm-float { position: absolute; }
.sgm-pass { width: min(340px, 86vw); border-radius: var(--h-radius-card); padding: 22px; color: var(--h-on-dark); background: linear-gradient(145deg, #1c1c1e, #3a2a4a); box-shadow: var(--h-shadow-float); text-align: left; display: flex; flex-direction: column; gap: 18px; }
.sgm-pass-top { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--h-on-dark-muted); }
.sgm-pass b { display: block; font-size: 28px; letter-spacing: -0.02em; color: var(--h-on-dark); }
.sgm-pass-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px; color: var(--h-on-dark-muted); }
.sgm-pass-meta strong { display: block; font-size: 15px; color: var(--h-on-dark); font-weight: var(--h-w-semibold); }
.sgm-glass-stage { position: relative; overflow: hidden; border-radius: var(--h-radius-tile); min-height: 320px; display: grid; place-items: end center; padding: 28px; background:
  radial-gradient(circle at 20% 30%, #ff8fd0 0 18%, transparent 19%),
  radial-gradient(circle at 70% 40%, #3c8cff 0 14%, transparent 15%),
  radial-gradient(circle at 45% 75%, #ff9f0a 0 12%, transparent 13%),
  repeating-linear-gradient(90deg, #2c2c2e 0 18px, #1c1c1e 18px 36px); }
.sgm-tabs { gap: 4px; padding: 6px; }
.sgm-tab { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; min-width: 64px; padding: 6px 10px; border-radius: var(--h-radius-pill); font-size: 11px; font-weight: var(--h-w-semibold); color: var(--h-on-dark); }
.sgm-tab[aria-current="page"] { background: rgb(255 255 255 / 0.18); }
.sgm-burst-btn { position: relative; }
.sgm-progress { height: 6px; border-radius: 6px; background: var(--h-ios-fill); overflow: hidden; margin-top: 18px; }
.sgm-progress i { display: block; height: 100%; background: var(--h-accent); transform-origin: left; transform: scaleX(var(--p, 1)); }
`;

const WARDS = [
  { ward: "Dadar West", dogs: 38, feeders: 21, cast: [CAST[0]!, CAST[2]!] },
  { ward: "Bandra", dogs: 52, feeders: 34, cast: [CAST[1]!, CAST[6]!] },
  { ward: "Colaba", dogs: 19, feeders: 12, cast: [CAST[5]!, CAST[3]!] },
];

const STORIES: Array<{ id: string; sticker: DogmojiAsset; ward: string; title: string; body: string; a: string; b: string }> = [
  { id: "bruno", sticker: "bowl-with-spoon", ward: "Dadar West", title: "Bruno has never missed a breakfast.", body: "Three feeders share his lane. Hetja tells each of them who already came.", a: "#ffe3ef", b: "#ffd0c2" },
  { id: "biscuit", sticker: "syringe", ward: "Bandra", title: "Biscuit's rabies shot is due Friday.", body: "Dr. Mehta added it to her record. Every feeder who scans her collar sees it.", a: "#e6ecff", b: "#f1e2ff" },
  { id: "kaalu", sticker: "crescent-moon", ward: "Worli", title: "Kaalu only comes out after 11pm.", body: "The night-shift feeders keep his streak. 212 days and counting.", a: "#e5e5ff", b: "#d9f0ff" },
  { id: "sheru", sticker: "adhesive-bandage", ward: "Sion", title: "Someone noticed Sheru's limp.", body: "One SOS, and the nearest vet had a photo and a pin within minutes.", a: "#fff2d6", b: "#ffe0e0" },
  { id: "rani", sticker: "trophy", ward: "Colaba", title: "Rani's lane hit 100 feeds.", body: "Twelve neighbours, one dog, one streak. The lane is proud of itself.", a: "#e3f7e8", b: "#fff5cc" },
];

const MANIFESTO =
  "Every street dog in Mumbai has someone. A feeder at 6am. A vet on Sunday. A neighbour who noticed the limp. Hetja just makes sure they can find each other.";

function Label({ children }: { children: string }): React.JSX.Element {
  return <code className="sgm-label">{children}</code>;
}

export function MotionSection(): React.JSX.Element {
  const [fired, setFired] = useState(0);

  const galleryItems: GalleryItem[] = STORIES.map((s) => ({
    id: s.id,
    label: s.title,
    content: (
      <article className="sgm-story" style={{ "--a": s.a, "--b": s.b } as React.CSSProperties}>
        <span className="h-chip">{s.ward}</span>
        <Sticker name={s.sticker} size={96} />
        <div>
          <h3>{s.title}</h3>
          <p className="h-muted" style={{ marginTop: 10 }}>
            {s.body}
          </p>
        </div>
      </article>
    ),
  }));

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SG_MOTION_CSS }} />

      {/* 1. Gradient headline + glowing, magnetic CTA */}
      <section className="h-section h-section-center" id="motion">
        <div className="h-container">
          <span className="h-chip">Motion kit</span>
          <h2 className="h-headline" style={{ marginTop: 22 }}>
            <GradientText>Motion that explains.</GradientText>
          </h2>
          <p className="h-lede">
            Scroll-driven, compositor-only, and <strong>off under reduced motion.</strong> Nothing here loops on /dog
            or /scan.
          </p>
          <div className="sgm-block sgm-row">
            <Magnetic>
              <GlowBorder glow="strong">
                <button type="button" className="h-btn h-btn-primary h-btn-lg sgm-cta">
                  Find a dog near you
                </button>
              </GlowBorder>
            </Magnetic>
            <GlowBorder radius="var(--h-radius-card)" width={3}>
              <span className="h-card" style={{ display: "block", padding: "18px 22px", textAlign: "left" }}>
                <b>Hetja is listening</b>
                <br />
                <span className="h-muted">GlowBorder around a card</span>
              </span>
            </GlowBorder>
          </div>
          <Label>{"<GradientText> · <GlowBorder> · <Magnetic>"}</Label>
        </div>
      </section>

      {/* 2. Manifesto: word-by-word scroll highlight */}
      <section className="h-section h-section-gray">
        <div className="h-container h-container-narrow">
          <Label>{"<HighlightText>"}</Label>
          <HighlightText text={MANIFESTO} emphasis={["someone.", "Hetja"]} />
          <ScrollScrub className="sgm-progress" mode="view">
            <i aria-hidden="true" />
          </ScrollScrub>
          <Label>{"<ScrollScrub> (bar is scaleX(var(--p)))"}</Label>
        </div>
      </section>

      {/* 3. Sticky hero zoom-out */}
      <StickyZoom
        label="Scan the collar"
        header={
          <>
            <Label>{"<StickyZoom from={1.15} to={1}>"}</Label>
            <h2 className="h-headline">Scan the collar. Log the feed.</h2>
            <p className="h-lede">Two taps, and every feeder on the lane knows Bruno ate.</p>
          </>
        }
      >
        <PhoneFrame label="Hetja app preview" time="6:02" live={{ label: "Feeding Bruno", timer: 42, tone: "ok" }}>
          <div className="sgm-screen">
            {CAST.slice(0, 3).map((d) => (
              <div key={d.key} className="sgm-screen-card">
                <Dogmoji dog={d} size={44} />
                <div style={{ flex: 1 }}>
                  <b>{d.name}</b>
                  <small>{d.ward}</small>
                </div>
                <StatusPill tone={d.late ? "late" : "ok"}>{d.late ? "Due" : "Fed"}</StatusPill>
              </div>
            ))}
          </div>
        </PhoneFrame>
      </StickyZoom>

      {/* 4. Staggered ward tiles */}
      <section className="h-section h-section-gray">
        <div className="h-container">
          <Label>{"<Stagger effect=\"rise\">"}</Label>
          <Stagger className="sgm-tiles">
            {WARDS.map((w) => (
              <div key={w.ward} className="h-tile">
                <div className="sgm-ward">
                  <b>{w.ward}</b>
                  <span className="sgm-face">
                    {w.cast.map((d) => (
                      <Dogmoji key={d.key} dog={d} size={36} />
                    ))}
                  </span>
                </div>
                <p className="h-tile-text">
                  {w.dogs} dogs, {w.feeders} feeders this week.
                </p>
              </div>
            ))}
          </Stagger>
          <div className="sgm-block">
            <Label>{"<ScrollReveal effect=\"clip\">"}</Label>
            <ScrollReveal effect="clip">
              <div className="h-tile" style={{ textAlign: "left" }}>
                <h3 className="h-title-tile">Verified by a vet, visible to every feeder.</h3>
                <p className="h-tile-text">Biscuit&apos;s record: rabies Mar 2026, sterilised, dewormed.</p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* 5. Stories gallery */}
      <section className="h-section h-section-center">
        <div className="h-container">
          <h2 className="h-headline">Stories from the lanes.</h2>
          <p className="h-lede">Swipe, use the arrows, or let it play. The pause button is always there.</p>
        </div>
        <div className="sgm-block">
          <Gallery items={galleryItems} label="Stories from the lanes" autoplay />
        </div>
        <div className="h-container">
          <Label>{"<Gallery autoplay> (WCAG 2.2.2 pause control)"}</Label>
        </div>
      </section>

      {/* 6. Depth: parallax stickers around a tilting pass */}
      <section className="h-section h-section-gray h-section-center">
        <div className="h-container">
          <Label>{"<Parallax pointer> · <ParallaxLayer> · <Tilt>"}</Label>
          <Parallax pointer className="sgm-scene">
            <ParallaxLayer depth={1.4} className="sgm-float" style={{ left: "8%", top: "10%" }}>
              <Sticker name="bone" size={72} />
            </ParallaxLayer>
            <ParallaxLayer depth={-0.8} className="sgm-float" style={{ right: "10%", top: "18%" }}>
              <Sticker name="red-heart" size={56} />
            </ParallaxLayer>
            <ParallaxLayer depth={0.6} className="sgm-float" style={{ left: "16%", bottom: "8%" }}>
              <Sticker name="paw-prints" size={64} />
            </ParallaxLayer>
            <ParallaxLayer depth={1.1} className="sgm-float" style={{ right: "14%", bottom: "12%" }}>
              <Sticker name="sparkles" size={52} />
            </ParallaxLayer>
            <ParallaxLayer depth={0.2} decorative={false}>
              <Tilt>
                <div className="sgm-pass">
                  <div className="sgm-pass-top">
                    <span>Hetja · Feeder pass</span>
                    <span>Dadar West</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <Dogmoji dog={CAST[0]!} size={56} />
                    <div>
                      <b>Bruno</b>
                      <span style={{ color: "var(--h-on-dark-muted)", fontSize: 13 }}>Collar HJ-0412</span>
                    </div>
                  </div>
                  <div className="sgm-pass-meta">
                    <span>
                      Streak<strong>47 days</strong>
                    </span>
                    <span>
                      Last fed<strong>6:02 am</strong>
                    </span>
                    <span>
                      Rabies<strong>Valid</strong>
                    </span>
                  </div>
                </div>
              </Tilt>
            </ParallaxLayer>
          </Parallax>
        </div>
      </section>

      {/* 7. Dark band: Liquid Glass accent */}
      <section className="h-section h-section-dark h-section-center">
        <div className="h-container">
          <h2 className="h-headline">
            <GradientText tone="warm">Glass, used sparingly.</GradientText>
          </h2>
          <p className="h-lede">
            Real refraction in Chromium, <strong>plain frosted blur everywhere else.</strong> One floating pill, never
            a whole band.
          </p>
          <div className="sgm-block sgm-glass-stage">
            <LiquidGlass as="nav" aria-label="Demo tab bar" className="sgm-tabs">
              {[
                { t: "Home", s: "house" as const, on: true },
                { t: "Scan", s: "camera" as const },
                { t: "Dogs", s: "dog-face" as const },
                { t: "SOS", s: "ambulance" as const },
              ].map((tab) => (
                <span key={tab.t} className="sgm-tab" aria-current={tab.on ? "page" : undefined}>
                  <Sticker name={tab.s} size={24} />
                  {tab.t}
                </span>
              ))}
            </LiquidGlass>
          </div>
          <Label>{"<LiquidGlass as=\"nav\">"}</Label>
        </div>
      </section>

      {/* 8. Celebration + route transition */}
      <section className="h-section h-section-center">
        <div className="h-container">
          <h2 className="h-headline">Feed logged.</h2>
          <p className="h-lede">The one celebration allowed on the working screens. It ends on its own in a second.</p>
          <div className="sgm-block sgm-row">
            <span className="sgm-burst-btn">
              <button type="button" className="h-btn h-btn-primary h-btn-lg" onClick={() => setFired((n) => n + 1)}>
                Log feed for Bruno
              </button>
              <PawBurst fire={fired} announce="Feed logged for Bruno" />
            </span>
            <TransitionLink href="/" className="h-btn h-btn-ghost h-btn-lg">
              Home, with a view transition
            </TransitionLink>
          </div>
          <Label>{"<PawBurst fire={n}> · <TransitionLink>"}</Label>
        </div>
      </section>
    </>
  );
}
