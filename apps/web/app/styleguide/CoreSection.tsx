import { CAST, DOGMOJI_ASSETS, castFor } from "@/lib/dogmoji";
import {
  Ambient,
  Bubble,
  ChatPlayer,
  Dogmoji,
  Facepile,
  Icon,
  ICON_NAMES,
  Marquee,
  NumberTicker,
  OrbitRing,
  PhoneFrame,
  Receipt,
  Reveal,
  Stamp,
  StatusPill,
  Sticker,
  TypingDots,
  type ChatMessage,
} from "@/components/ui";

/**
 * Styleguide: Core kit. Every core component rendered the way the pages
 * will use it, laid out in the same Sidehoe rhythm (hero → grey section →
 * white tiles) so the look is judged in context, not on a blank canvas.
 *
 * Layout helpers are a scoped <style> block (sg-* classes) rather than a CSS
 * module: this is a dev-only route and the helpers must never leak into the
 * component kit. <Ambient> is NOT mounted globally here (ChromeShell owns
 * that); a contained preview is shown instead.
 */

const SG_CSS = `
.sg-hero { overflow: hidden; overflow: clip; }
.sg-hero-grid {
  display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); align-items: center; gap: 24px;
  width: min(1240px, 100% - 44px); margin-inline: auto; padding-block: 32px 64px;
}
.sg-hero-copy { position: relative; z-index: 300; text-align: left; }
.sg-hero-copy .h-hero-headline { margin-top: 26px; }
.sg-hero-copy .h-lede { margin: 28px 0 0; max-width: 24em; }
.sg-hero-copy .h-actions { margin-top: 34px; font-size: var(--h-t-lg); }
@media (max-width: 899px) {
  .sg-hero-grid { grid-template-columns: minmax(0, 1fr); gap: 44px; padding-block: 44px 64px; }
  .sg-hero-copy { text-align: center; }
  .sg-hero-copy .h-lede { margin-inline: auto; }
  .sg-hero-copy .h-actions { justify-content: center; }
}
.sg-thread-name { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; }
.sg-block { margin-top: clamp(48px, 6vw, 72px); }
.sg-h3 { font-size: var(--h-t-xl); font-weight: var(--h-w-semibold); letter-spacing: -0.02em; margin: 0 0 18px; text-align: left; }
.sg-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(var(--min, 160px), 1fr)); text-align: left; }
.sg-swatch { background: var(--h-base); border-radius: var(--h-radius-card); box-shadow: var(--h-shadow-card); overflow: hidden; }
.sg-swatch i { display: block; height: 84px; background: var(--c); box-shadow: inset 0 -1px 0 var(--h-glass-edge); }
.sg-swatch div { padding: 12px 14px 14px; font-size: var(--h-t-xs); line-height: 1.4; color: var(--h-ink-muted); }
.sg-swatch b { display: block; font-size: 13px; font-weight: var(--h-w-semibold); color: var(--h-ink); }
.sg-type { display: flex; flex-direction: column; gap: 18px; text-align: left; }
.sg-type > div { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 20px; align-items: baseline; padding-bottom: 18px; border-bottom: 1px solid var(--h-glass-edge); }
.sg-type code, .sg-code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--h-ink-muted); letter-spacing: 0; }
.sg-type p { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 640px) { .sg-type > div { grid-template-columns: minmax(0, 1fr); gap: 6px; } }
.sg-row { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 16px; }
.sg-dog { background: var(--h-base); border-radius: var(--h-radius-tile); padding: 26px 18px 22px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.sg-dog b { font-size: var(--h-t-lg); font-weight: var(--h-w-semibold); letter-spacing: -0.015em; margin-top: 6px; }
.sg-dog small { font-size: 13px; color: var(--h-ink-muted); margin-top: -8px; }
.sg-icon { background: var(--h-base); border-radius: var(--h-radius); padding: 18px 10px 14px; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--h-ink); }
.sg-icon span { display: flex; gap: 14px; }
.sg-icon code { font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--h-ink-muted); letter-spacing: 0; }
.sg-lift { box-shadow: var(--h-shadow-card); }
.sg-num { font-size: clamp(52px, 5.6vw, 80px); }
.sg-stat { display: flex; flex-direction: column; gap: 4px; }
.sg-stat + .sg-stat { margin-top: 18px; }
.sg-preview { position: relative; isolation: isolate; height: 240px; border-radius: var(--h-radius-card); overflow: hidden; display: grid; place-items: center; box-shadow: 0 0 0 1px var(--h-glass-edge); }
.sg-preview .h-chip { position: relative; z-index: 2; }
.sg-chat { height: 380px; background: var(--h-base); border-radius: var(--h-radius-card); box-shadow: 0 0 0 1px var(--h-glass-edge); overflow: hidden; }
.sg-ward { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px 10px 12px; border-radius: var(--h-radius-pill); background: var(--h-base); box-shadow: var(--h-shadow-chip); font-size: var(--h-t-sm); font-weight: var(--h-w-medium); white-space: nowrap; }
.sg-ward em { font-style: normal; color: var(--h-ink-muted); font-weight: var(--h-w-regular); }
`;

const COLOURS: { token: string; note: string }[] = [
  { token: "--h-base", note: "page, tiles" },
  { token: "--h-gray", note: "sections, insets" },
  { token: "--h-ink", note: "text 16.8:1" },
  { token: "--h-ink-muted", note: "secondary 5.1:1" },
  { token: "--h-ink-faint", note: "non-text only" },
  { token: "--h-rule", note: "hairlines" },
  { token: "--h-accent", note: "the one blue pill" },
  { token: "--h-link", note: "text links" },
  { token: "--h-imessage", note: "bubbles, focus" },
  { token: "--h-bubble", note: "incoming bubble" },
  { token: "--h-danger", note: "SOS / overdue text" },
  { token: "--h-danger-fill", note: "SOS fill" },
  { token: "--h-safe", note: "vaccinated text" },
  { token: "--h-ok-bg", note: "ok pill" },
  { token: "--h-warn", note: "warn text" },
  { token: "--h-warn-bg", note: "warn pill" },
  { token: "--h-late-bg", note: "late pill" },
  { token: "--h-dark", note: "privacy band" },
  { token: "--h-dark-2", note: "card on dark" },
  { token: "--h-safe-on-dark", note: "live timer" },
  { token: "--h-aurora-1", note: "aurora pink" },
  { token: "--h-aurora-2", note: "aurora peach" },
  { token: "--h-aurora-3", note: "aurora orchid" },
  { token: "--h-aurora-4", note: "aurora rose" },
];

const TYPE: { token: string; label: string; style: React.CSSProperties; text: string }[] = [
  { token: "--h-t-hero", label: "Hero 700", style: { fontSize: "var(--h-t-hero)", fontWeight: 700, letterSpacing: "var(--h-track-hero)", lineHeight: 0.98 }, text: "Fed. Twice." },
  { token: "--h-t-display", label: "Display 600", style: { fontSize: "var(--h-t-display)", fontWeight: 600, letterSpacing: "var(--h-track-display)", lineHeight: 1.05 }, text: "Biscuit noticed." },
  { token: "--h-t-tile", label: "Tile 600", style: { fontSize: "var(--h-t-tile)", fontWeight: 600, letterSpacing: "var(--h-track-body)", lineHeight: 1.1 }, text: "Every shot, on time." },
  { token: "--h-t-lede", label: "Lede 500", style: { fontSize: "var(--h-t-lede)", fontWeight: 500, color: "var(--h-ink-muted)", lineHeight: 1.34 }, text: "Sheru's vet visit is Tuesday. Sheru has other plans." },
  { token: "--h-t-xl", label: "XL 600", style: { fontSize: "var(--h-t-xl)", fontWeight: 600 }, text: "Bruno · Dadar West" },
  { token: "--h-t-md", label: "Body 400", style: { fontSize: "var(--h-t-md)" }, text: "Fed at 7:42 AM by Asha, near the chai stall." },
  { token: "--h-t-sm", label: "Small 400", style: { fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)" }, text: "Coarsened to ward level. Never a street address." },
  { token: "--h-t-xs", label: "XS 400", style: { fontSize: "var(--h-t-xs)", color: "var(--h-ink-muted)" }, text: "1. Medical records are append-only." },
];

const WARDS = [
  ["Dadar West", 14],
  ["Bandra West", 22],
  ["Worli", 9],
  ["Matunga", 11],
  ["Sion", 7],
  ["Colaba", 18],
  ["Andheri East", 26],
  ["Chembur", 12],
  ["Powai", 8],
  ["Kurla", 15],
  ["Malad West", 19],
  ["Ghatkopar", 10],
] as const;

const HISTORY: ChatMessage[] = [
  { stamp: <><b>Yesterday</b> 8:12 PM</> },
  { from: "me", text: "fed bruno. he ate like it was his first meal" },
  { from: "them", text: "it was his fourth. Moti's feeder logged one at 6:40", gap: true },
  { from: "me", text: "traitor", gap: true },
  { stamp: <><b>Today</b> 9:41 AM</> },
];

const SCRIPT: ChatMessage[] = [
  { from: "them", text: "morning 🐾 lane report for Dadar West" },
  { from: "them", text: "Bruno: fed 2h ago by Asha. already lobbying for second breakfast" },
  { from: "them", text: "Biscuit's rabies shot is due Friday. Biscuit does not know" },
  { from: "them", text: "Sheru is limping on the back left. vet booked Tue, 11 AM" },
  { from: "me", text: "want me to check on him?", gap: true },
  { from: "them", text: "yes. he's behind the chai stall. bring Parle-G, not opinions", gap: true },
  { from: "me", text: "on my way", gap: true },
  { from: "them", text: "logged. the ward knows you've got Sheru today 🫡", gap: true },
];

const bruno = CAST[0]!;

function ThreadHeader(): React.JSX.Element {
  return (
    <>
      <Dogmoji dog={bruno} size={48} priority accessory={false} />
      <span className="sg-thread-name">
        Bruno
        <Icon name="check-circle" weight="fill" size={12} style={{ color: "var(--h-imessage)" }} />
      </span>
    </>
  );
}

function SectionTitle({ chip, title, lede }: { chip: string; title: string; lede: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <span className="h-chip">{chip}</span>
      <h2 className="h-headline" style={{ marginTop: 22 }}>
        {title}
      </h2>
      <p className="h-lede">{lede}</p>
    </>
  );
}

export function CoreSection(): React.JSX.Element {
  const realDog = castFor("dadar-w-017");
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SG_CSS }} />

      {/* ===== Hero: PhoneFrame + OrbitRing + live Dynamic Island ===== */}
      <section className="sg-hero" aria-labelledby="sg-hero-title">
        <div className="sg-hero-grid">
          <div className="sg-hero-copy">
            <span className="h-chip h-chip-logo h-rise">
              <Dogmoji dog={bruno} size={28} priority accessory={false} />
              Hetja <em>· for Mumbai&rsquo;s street dogs</em>
            </span>
            <h2 id="sg-hero-title" className="h-hero-headline">
              <span className="h-rise h-delay-1">Bruno ate.</span>
              <span className="h-rise h-delay-2">Again.</span>
            </h2>
            <p className="h-lede h-rise h-delay-3">
              Three times today. He&rsquo;ll tell you it was zero. <strong>Hetja keeps the count, the shots and the ward,</strong> so
              every feeder in the lane sees the same dog.
            </p>
            <div className="h-actions h-rise h-delay-4">
              <a className="h-btn h-btn-primary h-btn-lg" href="#sg-cast">
                <Icon name="scan" size={20} />
                Scan a collar
              </a>
              <a className="h-btn h-btn-link" href="#sg-chat">
                See the lane report
              </a>
            </div>
          </div>
          <OrbitRing>
            <PhoneFrame
              label="Hetja app preview"
              live={{ icon: <Icon name="bowl" weight="fill" size={16} />, label: "Feeding Bruno", timer: 134 }}
            >
              <ChatPlayer
                header={<ThreadHeader />}
                history={HISTORY}
                script={SCRIPT}
                composer
                placeholder="Log a feed"
                label="Lane report from Hetja"
              />
            </PhoneFrame>
          </OrbitRing>
        </div>
      </section>

      {/* ===== Tokens ===== */}
      <section className="h-section h-section-gray h-section-center" aria-labelledby="sg-tokens">
        <div className="h-container">
          <SectionTitle
            chip="Tokens"
            title="Colour, measured."
            lede={
              <>
                Every value lives in <strong>packages/design/tokens.css</strong>. Contrast is checked by a script, not by
                squinting.
              </>
            }
          />
          <h3 id="sg-tokens" className="h-sr-only">
            Colour tokens
          </h3>
          <div className="sg-grid sg-block" style={{ ["--min" as string]: "150px" }}>
            {COLOURS.map((c) => (
              <div key={c.token} className="sg-swatch">
                <i style={{ ["--c" as string]: `var(${c.token})` }} />
                <div>
                  <b>{c.token.replace("--h-", "")}</b>
                  {c.note}
                </div>
              </div>
            ))}
          </div>

          <div className="h-tile sg-block">
            <h3 className="sg-h3">Type</h3>
            <div className="sg-type">
              {TYPE.map((t) => (
                <div key={t.token}>
                  <code>
                    {t.label}
                    <br />
                    {t.token}
                  </code>
                  <p style={t.style}>{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== Controls ===== */}
      <section className="h-section h-section-center" aria-labelledby="sg-controls">
        <div className="h-container">
          <SectionTitle
            chip="Controls"
            title="One loud thing."
            lede={
              <>
                A blue pill for the primary action, <strong>red only for SOS,</strong> and quiet grey for everything else.
              </>
            }
          />
          <div className="h-bento sg-block">
            <div className="h-tile sg-lift h-span-7">
              <div>
                <h3 id="sg-controls" className="h-title-tile">
                  Buttons
                </h3>
                <p>Pills. Icon plus verb, always. Never colour alone.</p>
              </div>
              <div className="sg-row">
                <button type="button" className="h-btn h-btn-primary h-btn-lg">
                  <Icon name="bowl" weight="fill" /> Log a feed
                </button>
                <button type="button" className="h-btn h-btn-danger h-btn-lg">
                  <Icon name="siren" weight="fill" /> Send SOS
                </button>
              </div>
              <div className="sg-row">
                <button type="button" className="h-btn h-btn-primary">
                  Register a dog
                </button>
                <button type="button" className="h-btn h-btn-ghost">
                  <Icon name="share" /> Share
                </button>
                <button type="button" className="h-btn h-btn-primary h-btn-sm">
                  Scan
                </button>
                <button type="button" className="h-btn h-btn-primary" disabled>
                  Disabled
                </button>
                <a className="h-btn h-btn-link" href="#sg-controls">
                  Learn more
                </a>
              </div>
            </div>
            <div className="h-tile sg-lift h-span-5">
              <div>
                <h3 className="h-title-tile">Inputs</h3>
                <p>The collar code field, Sidehoe waitlist style.</p>
              </div>
              <div className="sg-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <label className="h-sr-only" htmlFor="sg-code">
                  Collar code
                </label>
                <input id="sg-code" className="h-input" placeholder="Collar code, e.g. DDR-017" style={{ width: "100%" }} />
                <span className="h-plate" style={{ alignSelf: "flex-start" }}>
                  DDR·017
                </span>
              </div>
            </div>
            <div className="h-tile sg-lift h-span-12">
              <div>
                <h3 className="h-title-tile">Status pills &amp; chips</h3>
                <p>The roster&rsquo;s age pill. The words carry the meaning; the tint only repeats it.</p>
              </div>
              <div className="sg-row">
                <StatusPill tone="ok" icon="check-circle">
                  Fed today
                </StatusPill>
                <StatusPill tone="warn" icon="clock">
                  2 days
                </StatusPill>
                <StatusPill tone="late" icon="syringe">
                  Rabies due Fri
                </StatusPill>
                <StatusPill tone="late" icon="warning">
                  9 days
                </StatusPill>
                <StatusPill icon="map-pin">Dadar West</StatusPill>
                <StatusPill tone="ok" icon={<Sticker name="fire" size={14} />}>
                  12-day streak
                </StatusPill>
                <span className="h-chip">
                  Verified feeder <em>· since 2024</em>
                </span>
                <span className="h-chip h-glass">
                  <Icon name="shield-check" weight="fill" size={16} style={{ color: "var(--h-safe)" }} /> Vaccinated
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Dogmoji ===== */}
      <section id="sg-cast" className="h-section h-section-gray h-section-center" aria-labelledby="sg-cast-title">
        <div className="h-container">
          <span className="h-chip">Dogmoji</span>
          <h2 id="sg-cast-title" className="h-headline" style={{ marginTop: 22 }}>
            The cast.
          </h2>
          <p className="h-lede">
            Ten Mumbai regulars in Fluent 3D. <strong>Any real dog without a photo gets one of these, and keeps it.</strong>
          </p>
          <div className="sg-grid sg-block" style={{ ["--min" as string]: "130px" }}>
            {CAST.map((d, i) => (
              <Reveal key={d.key} delay={(i % 5) * 80} className="sg-dog">
                <Dogmoji dog={d} size={84} />
                <b>{d.name}</b>
                <small>{d.ward}</small>
                <StatusPill tone={d.late ? "late" : "ok"}>{d.tag}</StatusPill>
              </Reveal>
            ))}
          </div>

          <div className="h-bento sg-block">
            <div className="h-tile h-span-6">
              <div>
                <h3 className="h-title-tile">Sizes &amp; fallbacks</h3>
                <p>
                  Photo wins when there is one; a broken photo falls back to the sticker; a broken sticker falls back to 🐶.
                  <span className="sg-code"> castFor(&quot;dadar-w-017&quot;) → {realDog.name}</span>
                </p>
              </div>
              <div className="sg-row" style={{ alignItems: "flex-end" }}>
                <Dogmoji dog={CAST[2]!} size={32} />
                <Dogmoji dog={CAST[3]!} size={48} />
                <Dogmoji dog={CAST[4]!} size={72} />
                <Dogmoji seed="dadar-w-017" size={112} label={`${realDog.name}, a real dog without a photo`} />
                <Dogmoji seed="broken" photoUrl="/dogmoji/does-not-exist.jpg" size={72} />
              </div>
              <Facepile size={40} max={7} />
            </div>
            <div className="h-tile h-span-6">
              <div>
                <h3 className="h-title-tile">Stickers</h3>
                <p>Plain 3D emoji for tiles, badges and empty states.</p>
              </div>
              <div className="sg-row" style={{ gap: 10 }}>
                {DOGMOJI_ASSETS.map((a) => (
                  <Sticker key={a} name={a} size={40} alt={a} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Icons ===== */}
      <section className="h-section h-section-center" aria-labelledby="sg-icons">
        <div className="h-container">
          <span className="h-chip">Icons</span>
          <h2 id="sg-icons" className="h-headline" style={{ marginTop: 22 }}>
            Regular. Filled.
          </h2>
          <p className="h-lede">
            Phosphor, inline, no dependency. <strong>Regular at rest, filled when selected</strong>: the SF Symbols habit.
          </p>
          <div className="sg-grid sg-block" style={{ ["--min" as string]: "116px" }}>
            {ICON_NAMES.map((n) => (
              <div key={n} className="sg-icon sg-lift">
                <span>
                  <Icon name={n} size={26} />
                  <Icon name={n} weight="fill" size={26} />
                </span>
                <code>{n}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Ward marquee ===== */}
      <section className="h-section-gray" style={{ paddingBlock: 36 }} aria-label="Wards marquee">
        <Marquee label="Mumbai wards on Hetja" speed={50}>
          {WARDS.map(([w, n]) => (
            <span key={w} className="sg-ward">
              <Icon name="map-pin" weight="fill" size={16} style={{ color: "var(--h-danger-fill)" }} />
              {w} <em>· {n} dogs</em>
            </span>
          ))}
        </Marquee>
        <div style={{ height: 14 }} />
        <Marquee reverse speed={60}>
          {CAST.map((d) => (
            <span key={d.key} className="sg-ward">
              <Dogmoji dog={d} size={24} accessory={false} />
              {d.name} <em>· {d.tag}</em>
            </span>
          ))}
        </Marquee>
      </section>

      {/* ===== Motion bento ===== */}
      <section className="h-section h-section-gray h-section-center" aria-labelledby="sg-motion">
        <div className="h-container">
          <span className="h-chip">Motion</span>
          <h2 id="sg-motion" className="h-headline" style={{ marginTop: 22 }}>
            Motion that explains.
          </h2>
          <p className="h-lede">
            Things rise in, bubbles pop, numbers count. <strong>All of it switches off under reduced motion.</strong>
          </p>
          <div className="h-bento sg-block">
            <Reveal className="h-tile h-span-7" id="sg-chat">
              <div>
                <h3 className="h-title-tile">The feed log, as iMessage.</h3>
                <p>ChatPlayer plays once it scrolls into view. Tap the header to replay.</p>
              </div>
              <div className="sg-chat h-tile-visual">
                <ChatPlayer header={<ThreadHeader />} history={HISTORY.slice(-1)} script={SCRIPT.slice(0, 5)} startDelay={600} />
              </div>
            </Reveal>
            <Reveal className="h-tile h-span-5" delay={100}>
              <div>
                <h3 className="h-title-tile">Numbers that count.</h3>
                <p>Server HTML carries the final value; the count-up is decoration.</p>
              </div>
              <div className="h-tile-visual">
                <div className="sg-stat">
                  <NumberTicker value={1284} className="h-bignum sg-num" />
                  <span className="h-muted">dogs tracked</span>
                </div>
                <div className="sg-stat">
                  <NumberTicker value={36410} className="h-bignum sg-num" delay={120} />
                  <span className="h-muted">feeds logged</span>
                </div>
                <div className="sg-stat">
                  <NumberTicker value={412} suffix="+" className="h-bignum sg-num" delay={240} />
                  <span className="h-muted">shots on time</span>
                </div>
              </div>
            </Reveal>
            <Reveal className="h-tile h-span-6">
              <div>
                <h3 className="h-title-tile">Ambient aurora.</h3>
                <p>WebGL at a third of the resolution over four drifting CSS blobs. Contained preview.</p>
              </div>
              <div className="sg-preview h-tile-visual">
                <Ambient contained />
                <span className="h-chip">aurora</span>
              </div>
            </Reveal>
            <Reveal className="h-tile h-span-6" delay={100}>
              <div>
                <h3 className="h-title-tile">Plain, and the fallback.</h3>
                <p>variant=&quot;plain&quot; for working screens (/dog, /scan): nothing loops there.</p>
              </div>
              <div className="sg-preview h-tile-visual">
                <Ambient contained variant="plain" />
                <span className="h-chip">plain</span>
              </div>
            </Reveal>
            <Reveal className="h-tile h-span-4">
              <div>
                <h3 className="h-title-tile">Live Activity.</h3>
                <p>The island springs open and the timer counts up.</p>
              </div>
              <div className="h-tile-visual" style={{ width: "100%", maxWidth: 260, marginInline: "auto" }}>
                <div style={{ height: 230, overflow: "hidden" }}>
                  <PhoneFrame
                    scaleToFit
                    live={{ icon: <Icon name="siren" weight="fill" size={16} />, label: "SOS · vet en route", timer: "4 min", tone: "late" }}
                  >
                    <div style={{ padding: "18px 20px", display: "grid", gap: 10 }}>
                      <Dogmoji dog={CAST[4]!} size={56} />
                      <b style={{ fontSize: 19 }}>Sheru</b>
                      <StatusPill tone="late" icon="first-aid">
                        Limping · Sion
                      </StatusPill>
                    </div>
                  </PhoneFrame>
                </div>
              </div>
            </Reveal>
            <Reveal className="h-tile h-span-4" delay={80}>
              <div>
                <h3 className="h-title-tile">Scale to fit.</h3>
                <p>The phone shrinks to its column and reserves its height.</p>
              </div>
              <div className="h-tile-visual" style={{ maxWidth: 200, marginInline: "auto", width: "100%" }}>
                <PhoneFrame scaleToFit>
                  <div style={{ padding: "18px 20px", display: "grid", gap: 10 }}>
                    <Dogmoji dog={CAST[1]!} size={72} />
                    <b style={{ fontSize: 24 }}>Biscuit</b>
                    <StatusPill tone="late" icon="syringe">
                      Rabies due Fri
                    </StatusPill>
                  </div>
                </PhoneFrame>
              </div>
            </Reveal>
            <Reveal className="h-tile h-span-4" delay={160}>
              <div>
                <h3 className="h-title-tile">Bubbles.</h3>
                <p>Stamp, bubbles, typing, receipt.</p>
              </div>
              <div className="h-tile-visual" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Stamp>
                  <b>Today</b> 7:42 AM
                </Stamp>
                <Bubble from="me">Fed Kaalu 🍚</Bubble>
                <Receipt>Delivered</Receipt>
                <Bubble gap>Logged. That&rsquo;s his second. He&rsquo;ll deny it.</Bubble>
                <TypingDots gap />
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
