import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Aurora,
  Badge,
  Button,
  Card,
  CollarCode,
  CollarCodeInput,
  DogAvatar,
  Footer,
  Label,
  ListGroup,
  ListRow,
  Logo,
  PrivacyBand,
  Progress,
  SectionFade,
  StatusPill,
  StickyFooter,
  TabBar,
  TopNav,
} from "@/components/ds";
import type { AvatarPalette } from "@/components/ds";
import s from "./design.module.css";

/**
 * Dev-only style guide. Lays the components out exactly like the handoff's
 * "Hetja Design System" mock so the two can be screenshotted side by side,
 * then shows the pieces the mock only has in context (nav, footer, band,
 * sticky footers) under "In context". 404 in production unless
 * HETJA_STYLEGUIDE=1; never indexed.
 */

export const metadata: Metadata = {
  title: "Design system · Hetja",
  robots: { index: false, follow: false },
};

// Evaluate the env gate per request, not once at build time.
export const dynamic = "force-dynamic";

const SWATCHES: { name: string; token: string; note: string; ring?: boolean }[] = [
  { name: "Blue #0071e3", token: "var(--h-blue)", note: "Every normal action. White text 4.7:1" },
  { name: "SOS red #d70015", token: "var(--h-sos)", note: "SOS only. White text 5.6:1" },
  { name: "Ink #1d1d1f", token: "var(--h-ink)", note: "Headlines, body, privacy band" },
  { name: "Secondary #6e6e73", token: "var(--h-secondary)", note: "Supporting text. 5.1:1 on white" },
  { name: "Mist #f5f5f7", token: "var(--h-mist)", note: "App background, quiet fills", ring: true },
  { name: "Hairline #d2d2d7", token: "var(--h-line)", note: "Dividers and input borders" },
];

const SLOTS: { palette: AvatarPalette; label: string; caption: string }[] = [
  { palette: "apricot", label: "3D dog: tan indie", caption: "Apricot #ffe3c2" },
  { palette: "lilac", label: "3D dog: black", caption: "Lilac #e4defa" },
  { palette: "mint", label: "3D dog: brindle", caption: "Mint #d7efe3" },
  { palette: "rose", label: "3D dog: white, one ear up", caption: "Rose #ffd9e6" },
  { palette: "sky", label: "3D dog: grey muzzle", caption: "Sky #dbe9fb" },
];

const SPACES = [4, 8, 12, 16, 24, 32, 48, 72];

function SlotIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className={s.slotIcon}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function DesignPage(): React.JSX.Element {
  if (process.env.NODE_ENV === "production" && process.env.HETJA_STYLEGUIDE !== "1") {
    notFound();
  }

  return (
    <div className={s.canvas}>
      <section className={s.sheet} data-ds-sheet="system">
        <header className={s.header}>
          <Logo size={40} />
          <h1 className={s.h1}>Design system.</h1>
          <p className={s.lead}>
            Small on purpose. System fonts, so nothing downloads on slow 4G. Two loud colours: blue
            for doing things, red for emergencies. Everything else is ink, grey and white.
          </p>
        </header>

        <div className={s.grid}>
          {/* Colour */}
          <Card as="article" className={s.article} padding="32px">
            <h2 className={s.h2}>Colour</h2>
            <div className={s.swatches}>
              {SWATCHES.map((sw) => (
                <div key={sw.name} className={s.swatch}>
                  <div
                    className={[s.chip, sw.ring ? s.chipRing : ""].join(" ")}
                    style={{ background: sw.token }}
                  />
                  <div className={s.swName}>{sw.name}</div>
                  <div className={s.note}>{sw.note}</div>
                </div>
              ))}
            </div>
            <div className={s.swatch}>
              <div className={s.auroraChip} />
              <div className={s.swName}>Aurora</div>
              <div className={s.note}>
                Pink #ffb3dc, peach #ffcbb8, rose #ffc2ec on #fdf6f8. Marketing and reading pages
                only. Never on Scan, Dog profile or /hetja.
              </div>
            </div>
            <div className={s.states}>
              <div className={s.swatch}>
                <div className={[s.stateChip, s.okChip].join(" ")}>#1a7a35</div>
                <div className={s.note}>Done / healthy</div>
              </div>
              <div className={s.swatch}>
                <div className={[s.stateChip, s.warnChip].join(" ")}>#9a5200</div>
                <div className={s.note}>Due / waiting</div>
              </div>
              <div className={s.swatch}>
                <div className={[s.stateChip, s.neutralChip].join(" ")}>#48484d</div>
                <div className={s.note}>Unknown</div>
              </div>
            </div>
          </Card>

          {/* Type */}
          <Card as="article" className={[s.article, s.gap18].join(" ")} padding="32px">
            <h2 className={s.h2}>Type</h2>
            <div className={s.note}>
              System stack: SF Pro on iPhone, Roboto on Android. Zero bytes to download.
            </div>
            <div className={s.typeRow}>
              <div className={s.tDisplay}>Fed. Twice.</div>
              <div className={s.note}>Display · 56 / 1.0 · 700 · -0.045em (96 on desktop)</div>
            </div>
            <div className={s.typeRow}>
              <div className={s.tTitle}>Bruno</div>
              <div className={s.note}>Title · 34 / 1.1 · 700 · -0.03em</div>
            </div>
            <div className={s.typeRow}>
              <div className={s.tHeading}>How bad is it?</div>
              <div className={s.note}>Heading · 22 / 1.25 · 700</div>
            </div>
            <div className={s.typeRow}>
              <div className={s.tBody}>Bruno likes Parle-G more than he should.</div>
              <div className={s.note}>Body · 17 / 1.47 · 400. Never smaller than 15 for reading.</div>
            </div>
            <div className={s.typeRow}>
              <Label>Collar code</Label>
              <div className={s.note}>Label · 13 · 600 · caps · +0.06em</div>
            </div>
          </Card>

          {/* Collar code */}
          <Card as="article" className={[s.article, s.gap18].join(" ")} padding="32px">
            <h2 className={s.h2}>Collar code</h2>
            <p className={s.p15}>
              Stored as <span className={s.mono}>ddr017xk2</span>. Shown uppercase in three groups of
              three, monospaced, so it can be read over a bad phone line. The code alphabet should
              skip 0/O, 1/I/L.
            </p>
            <CollarCode code="ddr017xk2" size="large" sayIt copy={false} />
            <CollarCodeInput
              label="Input"
              defaultValue="ddr234"
              helper="Auto-spaces as you type. Accepts any case."
            />
          </Card>

          {/* Buttons */}
          <Card as="article" className={[s.article, s.gap18].join(" ")} padding="32px">
            <h2 className={s.h2}>Buttons</h2>
            <p className={s.p15}>
              One loud button per screen, full width, in the bottom third. Minimum 56px tall on
              phones.
            </p>
            <div className={s.buttons}>
              <Button fullWidth href="/scan">
                Scan a collar
              </Button>
              <Button variant="sos" fullWidth>
                This dog needs help
              </Button>
              <div className={s.btnRow}>
                <Button variant="quiet">Quiet</Button>
                <Button variant="tinted">Call</Button>
                <Button variant="link" chevron href="/scan">
                  Text link
                </Button>
                <Button variant="navPill">Nav pill</Button>
              </div>
            </div>
            <div className={s.note}>
              Pressed: darken to #0062c4 / #b80012 and scale 0.98. No hover animation on phones.
            </div>
          </Card>

          {/* Status pills */}
          <Card as="article" className={[s.article, s.gap18].join(" ")} padding="32px">
            <h2 className={s.h2}>Status pills</h2>
            <p className={s.p15}>Icon plus words, always. Colour is the third clue, never the first.</p>
            <div className={s.pills}>
              <StatusPill variant="ok" icon="check">
                Vaccinated
              </StatusPill>
              <StatusPill variant="ok" icon="check">
                Sterilised
              </StatusPill>
              <StatusPill variant="warn" icon="clock">
                Vaccine due
              </StatusPill>
              <StatusPill variant="neutral" icon="cross">
                Not sterilised
              </StatusPill>
              <StatusPill variant="danger" icon="alert">
                SOS open
              </StatusPill>
            </div>
          </Card>

          {/* Cards and list rows */}
          <Card as="article" className={[s.article, s.gap14].join(" ")} padding="32px">
            <h2 className={s.h2}>Cards and list rows</h2>
            <p className={s.p15}>
              Cards: white, 28px radius, 24px padding, no border on aurora, 1px #e8e8ed on white.
              Rows: 72px min, 56px avatar.
            </p>
            <ListGroup tone="mist">
              <ListRow
                leading={<DogAvatar id="bruno" name="Bruno" palette="apricot" size={52} />}
                title="Bruno"
                sub="K/W ward · Andheri West"
                trailing={
                  <StatusPill variant="ok" icon="check" size="row">
                    Fed 2h ago
                  </StatusPill>
                }
              />
              <ListRow
                leading={<DogAvatar id="kaali" name="Kaali" palette="lilac" size={52} />}
                title="Kaali"
                sub="K/W ward · Andheri West"
                trailing={
                  <StatusPill variant="warn" icon="clock" size="row">
                    Not fed today
                  </StatusPill>
                }
              />
            </ListGroup>
          </Card>

          {/* Dog avatars */}
          <Card as="article" className={[s.article, s.gap18, s.full].join(" ")} padding="32px">
            <h2 className={s.h2}>Dog avatars</h2>
            <p className={[s.p15, s.max760].join(" ")}>
              Friendly 3D busts of Indian street dogs (indie / pariah build, big ears, one floppy),
              soft studio light, shoulders cropped, on a pastel circle. One colour per dog, stable
              forever. Drop renders below. Until a render exists, the app shows the pastel circle
              with the dog&apos;s initial.
            </p>
            <div className={s.avatars}>
              {SLOTS.map((slot) => (
                <div key={slot.palette} className={s.avatarCell}>
                  <div className={[s.slot, s[`slot_${slot.palette}`]].join(" ")}>
                    <SlotIcon />
                    <span>{slot.label}</span>
                  </div>
                  <div className={s.note}>{slot.caption}</div>
                </div>
              ))}
              <div className={s.vRule} />
              <div className={s.avatarCell}>
                <DogAvatar id="bruno" name="Bruno" palette="apricot" size={120} />
                <div className={s.note}>Fallback</div>
              </div>
              <div className={s.avatarCell}>
                <DogAvatar id="kaali" name="Kaali" palette="lilac" size={56} />
                <div className={s.note}>56 row</div>
              </div>
              <div className={s.avatarCell}>
                <DogAvatar id="motu" name="Motu" palette="mint" size={36} />
                <div className={s.note}>36 chip</div>
              </div>
            </div>
          </Card>

          {/* Spacing and shape */}
          <Card as="article" className={[s.article, s.gap18].join(" ")} padding="32px">
            <h2 className={s.h2}>Spacing and shape</h2>
            <div className={s.spaces}>
              {SPACES.map((n) => (
                <div key={n} className={s.space}>
                  <div className={s.spaceBox} style={{ width: n, height: n }} />
                  <div className={s.spaceNum}>{n}</div>
                </div>
              ))}
            </div>
            <div className={s.shapeNote}>
              Phone gutter 20. Radii: input 16, inner card 20, card 28, phone sheet 32, pill 999.
              Touch target 44 minimum, 56 for main buttons.
            </div>
          </Card>

          {/* Bars */}
          <Card as="article" className={[s.article, s.gap18].join(" ")} padding="32px">
            <h2 className={s.h2}>Bars</h2>
            <div className={s.navDemo}>
              <TopNav
                layout="mobile"
                surface="solid"
                sticky={false}
                right={
                  <Button variant="navPill" href="/scan">
                    Scan
                  </Button>
                }
              />
              <div className={s.navNote}>
                Frosted top nav. White 72% + blur 20. Nav pill hides on screens that already have
                their own main button.
              </div>
            </div>
            <div className={s.tabDemo}>
              <TabBar position="static" active="home" />
            </div>
            <div className={s.note}>
              Tab bar: three tabs, label always visible, active tab gets ink + a bar. Hidden during
              SOS.
            </div>
          </Card>

          {/* Privacy band */}
          <Card as="article" tone="black" className={[s.article, s.gap12].join(" ")} padding="32px">
            <h2 className={s.h2}>Privacy band</h2>
            <div className={s.bandHead}>Ward, not street.</div>
            <p className={s.bandP}>
              Pure black, off-white type, grey #a1a1a6 for support (7.9:1). Used once per marketing
              page, for the privacy promise.
            </p>
          </Card>
        </div>
      </section>

      {/* ----------------------------------------------------------------
       * In context: components the mock sheet only shows inside screens.
       * Each frame copies its screen in the Pages / App / Desktop mocks.
       * -------------------------------------------------------------- */}
      <section className={[s.sheet, s.sheetWide].join(" ")} data-ds-sheet="context">
        <header className={s.header}>
          <h1 className={s.h1small}>In context.</h1>
          <p className={s.lead}>
            The same components where the screens use them: nav, sticky footers, the scan sheet,
            the Me card, the band and the footer.
          </p>
        </header>

        <div className={s.phones}>
          {/* 01 Home: nav on aurora */}
          <div className={s.phone} data-frame="home">
            <Aurora variant="home">
              <TopNav layout="mobile" sticky={false} />
              <div className={s.heroDemo}>
                <div className={s.heroTitle}>Every street has a hero.</div>
                <div className={s.avatarRow}>
                  {(["apricot", "lilac", "mint", "rose", "sky"] as const).map((p, i) => (
                    <DogAvatar
                      key={p}
                      id={p}
                      name={p}
                      palette={p}
                      size={56}
                      ring="var(--h-aurora-base)"
                      className={i ? s.overlap : ""}
                    />
                  ))}
                </div>
                <Button fullWidth size="hero" href="/scan">
                  Scan a collar
                </Button>
                <Button variant="link" chevron href="/scan/code">
                  Or type a collar code
                </Button>
              </div>
            </Aurora>
          </div>

          {/* 03 Profile: collar card + SOS sticky footer */}
          <div className={s.phone} data-frame="profile">
            <div className={s.phoneBody}>
              <div className={s.pills8}>
                <StatusPill variant="ok" icon="check">
                  Vaccinated
                </StatusPill>
                <StatusPill variant="ok" icon="check">
                  Sterilised
                </StatusPill>
                <StatusPill variant="neutral" icon="clock">
                  Last fed 2 hours ago
                </StatusPill>
              </div>
              <CollarCode code="ddr017xk2" />
              <p className={s.story}>
                Bruno turned up in 2019 and decided the lane was his. Scared of scooters, not of
                cats. Will sit on your foot until you leave.
              </p>
              <div className={s.byline}>Written by his 3 feeders</div>
            </div>
            <StickyFooter position="static" caption="Alerts his feeders and a vet nearby.">
              <Button variant="sos" fullWidth href="/dog/ddr017xk2/sos">
                This dog needs help
              </Button>
            </StickyFooter>
          </div>

          {/* 02 Scan sheet + 04 SOS footer */}
          <div className={s.phone} data-frame="scan">
            <div className={s.sheetDemo}>
              <CollarCodeInput
                prompt="No camera, or the QR is muddy?"
                aria-label="Collar code"
                defaultValue="ddr234xk2"
              />
              <Button fullWidth shadow={false}>
                View profile
              </Button>
            </div>
            <div className={s.sheetDemo}>
              <CollarCodeInput
                aria-label="Collar code"
                defaultValue="kaa"
                error="No dog with that code. Check the letters and try again."
              />
            </div>
            <StickyFooter
              position="static"
              background="none"
              captionPosition="above"
              caption="Shares K/W ward with feeders. Never your exact spot."
            >
              <Button variant="sos" fullWidth bang={false}>
                Send SOS
              </Button>
            </StickyFooter>
            <div className={s.callRows}>
              <Label>Call now</Label>
              <ListGroup tone="none">
                <ListRow
                  density="tall"
                  title="Dr. Mehta, Pet Clinic"
                  sub="Vet · K/W ward · open till 9 pm"
                  trailing={
                    <Button variant="tinted" size="lg" href="tel:+910000000000">
                      Call
                    </Button>
                  }
                />
                <ListRow
                  density="tall"
                  title="Priya, feeder"
                  sub="Feeds Bruno most evenings"
                  trailing={
                    <Button variant="tinted" size="lg" href="tel:+910000000001">
                      Call
                    </Button>
                  }
                />
              </ListGroup>
            </div>
          </div>

          {/* 09 Me: badges, rows, fade footer, tab bar */}
          <div className={[s.phone, s.mist].join(" ")} data-frame="me">
            <div className={[s.phoneBody, s.gap10].join(" ")}>
              <Card padding="16px 18px" className={s.streak}>
                <div className={s.streakTop}>
                  <div className={s.streakNum}>23</div>
                  <div className={s.streakUnit}>day streak</div>
                </div>
                <div className={s.p15}>
                  Fed someone every day since 1 September. Bruno still says you missed Tuesday.
                </div>
                <div className={s.badges}>
                  <Badge mark="1st" label="First feed" palette="apricot" />
                  <Badge mark="7" label="A full week" palette="mint" />
                  <Badge mark="M" label="Monsoon feeder" palette="sky" />
                  <Badge mark="30" label="A full month" locked remaining="7 days to go" />
                </div>
              </Card>
              <Progress
                label="Trusted feeder · Level 2"
                target="Level 3 at 50"
                value={0.84}
                valueText="42 of 50 feeds"
              />
              <Label className={s.myDogs}>My dogs</Label>
              <ListGroup tone="white">
                <ListRow
                  density="compact"
                  leading={<DogAvatar id="bruno" name="Bruno" palette="apricot" size={44} />}
                  title="Bruno"
                  trailing={
                    <StatusPill variant="ok" icon="check" size="row">
                      Fed 2h ago
                    </StatusPill>
                  }
                />
                <ListRow
                  density="compact"
                  leading={<DogAvatar id="kaali" name="Kaali" palette="lilac" size={44} />}
                  title="Kaali"
                  trailing={
                    <StatusPill variant="warn" icon="clock" size="row">
                      Not fed today
                    </StatusPill>
                  }
                />
              </ListGroup>
            </div>
            <StickyFooter position="static" background="fade">
              <Button fullWidth href="/scan">
                Scan to log Kaali&apos;s feed
              </Button>
            </StickyFooter>
            <TabBar position="static" active="me" />
          </div>

          {/* 01 Home bottom: band, footer, tab bar */}
          <div className={s.phone} data-frame="band">
            <SectionFade>
              <PrivacyBand layout="mobile" id="band-mobile" />
            </SectionFade>
            <Footer layout="mobile" />
            <TabBar position="static" active="home" />
          </div>

          {/* 17 /hetja nav */}
          <div className={[s.phone, s.memorial].join(" ")} data-frame="memorial">
            <TopNav tone="memorial" layout="mobile" sticky={false} />
          </div>
        </div>

        {/* 18 Desktop */}
        <div className={s.desktop} data-frame="desktop">
          <Aurora variant="desktop" className={s.deskHero}>
            <TopNav layout="desktop" sticky={false} />
          </Aurora>
          <PrivacyBand layout="desktop" id="band-desktop" />
          <Footer layout="desktop" />
        </div>
      </section>
    </div>
  );
}
