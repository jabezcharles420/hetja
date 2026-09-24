import {
  Aurora,
  Button,
  Card,
  DogAvatar,
  Label,
  LogoMark,
  PrivacyBand,
  SectionFade,
  StatusPill,
  type AvatarPalette,
} from "@/components/ds";
import { formatCount, getImpactStats } from "./_home/impact";
import s from "./home.module.css";

/* Screen 01 (Pages mock, 390) and screen 18 (Desktop Landing, >=1024).
 * One document for both: shared copy renders once, and the few lines the two
 * mocks word differently are rendered twice with .mOnly / .dOnly. */

interface HeroDog {
  name: string;
  palette: AvatarPalette;
  caption: string;
  /** Desktop floating-avatar diameter (Landing 18). */
  size: number;
  pos: string;
}

/* Order = the mobile avatar row (apricot, lilac, mint, rose, sky). */
const HERO_DOGS: HeroDog[] = [
  { name: "Bruno", palette: "apricot", caption: "Fed 3 times. Claims zero.", size: 116, pos: s.fBruno },
  { name: "Kaali", palette: "lilac", caption: "Kaali · guards the chaiwala", size: 96, pos: s.fKaali },
  { name: "Motu", palette: "mint", caption: "Motu · sterilised 2024", size: 88, pos: s.fMotu },
  { name: "Rani", palette: "rose", caption: "Rani · afraid of pigeons", size: 108, pos: s.fRani },
  { name: "Sheru", palette: "sky", caption: "Sheru · 11 years on the job", size: 100, pos: s.fSheru },
];

const STEPS = [
  {
    title: "Scan the collar.",
    text: "Any phone camera. Or type the 9 letters printed under the QR.",
  },
  {
    title: "Meet the dog.",
    text: "Name, ward, shots, and a few lines from the people who feed them. Usually about biscuits.",
  },
  {
    title: "Help, if they need it.",
    text: "One red button tells nearby feeders and a vet. You don't need an account for that.",
  },
];

const PHONE_LABEL =
  "A dog profile on a phone: Bruno, K/W ward, Andheri West. Vaccinated. Sterilised. Collar code DDR 017 XK2.";

function Code(): React.JSX.Element {
  return (
    <>
      <span>DDR</span>
      <span>017</span>
      <span>XK2</span>
    </>
  );
}

function Pills(): React.JSX.Element {
  return (
    <div className={s.pills}>
      <StatusPill variant="ok" icon="check" size="small">
        Vaccinated
      </StatusPill>
      <StatusPill variant="ok" icon="check" size="small">
        Sterilised
      </StatusPill>
    </div>
  );
}

/** Pages 01: 270 wide, 9px ink bezel, cropped by the bottom of the hero. */
function MobilePhone(): React.JSX.Element {
  return (
    <div className={s.mPhoneWrap}>
      <div className={s.mPhone} role="img" aria-label={PHONE_LABEL}>
        <div className={s.mPhoto} />
        <div className={s.mName}>Bruno</div>
        <div className={s.mWard}>K/W ward · Andheri West</div>
        <Pills />
        <div className={s.mCode}>
          <Code />
        </div>
        <div className={s.mStory}>Scared of scooters, not of cats.</div>
      </div>
    </div>
  );
}

/** Landing 18: 300 x 620 phone, five floating avatars with caption chips. */
function DesktopArt(): React.JSX.Element {
  return (
    <div className={s.dArt}>
      <div className={s.dArtInner}>
        <div className={s.dPhone} role="img" aria-label={PHONE_LABEL}>
          <div className={s.dNotch} />
          <div className={s.dPhoto} />
          <div className={s.dName}>Bruno</div>
          <div className={s.dWard}>K/W ward · Andheri West</div>
          <Pills />
          <div className={s.dCodeCard}>
            <div className={s.dCodeLabel}>Collar code</div>
            <div className={s.dCode}>
              <Code />
            </div>
          </div>
          <div className={s.dStory}>Bruno turned up in 2019 and decided the lane was his.</div>
          <div className={s.dSos}>This dog needs help</div>
        </div>
        {HERO_DOGS.map((d) => (
          <div
            key={d.name}
            className={`${s.float} ${d.pos}`}
            style={{ "--d": `${d.size}px` } as React.CSSProperties}
          >
            <DogAvatar
              id={d.name.toLowerCase()}
              name={d.name}
              palette={d.palette}
              size={104}
              className={s.floatAv}
            />
            <div className={s.chip}>{d.caption}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function LandingPage(): Promise<React.JSX.Element> {
  const stats = await getImpactStats();
  const dogs = formatCount(stats?.dogsTracked);
  const feeds = formatCount(stats?.feedsLogged);

  return (
    <>
      <Aurora variant="home" drift className={s.hero}>
        <div className={s.heroGrid}>
          <div className={`h-container ${s.heroText}`}>
            <p className={s.badge}>
              <LogoMark size={28} />
              <b>Hetja</b>
              <span className={s.badgeSub}>for Mumbai&apos;s street dogs</span>
            </p>
            <h1 className={s.title}>
              Every street <br className={s.dBr} />
              has a hero.
            </h1>
            <p className={s.lead}>
              Scan the QR on a dog&apos;s collar.{" "}
              <span className={s.leadInk}>
                See who they are, if they&apos;ve eaten, and whether they&apos;ve had their shots.
              </span>{" "}
              Then carry on with your day, slightly more attached.
            </p>
            <div className={`${s.avatarRow} ${s.mOnly}`}>
              {HERO_DOGS.map((d) => (
                <DogAvatar
                  key={d.name}
                  id={d.name.toLowerCase()}
                  name={d.name}
                  palette={d.palette}
                  size={56}
                  ring="var(--h-aurora-base)"
                  className={s.avatar}
                />
              ))}
            </div>
            <div className={s.ctas}>
              <Button fullWidth size="hero" href="/scan" className={s.scanBtn}>
                Scan a collar
              </Button>
              <Button variant="link" chevron href="/scan#code" className={`${s.textLink} ${s.mOnly}`}>
                Or type a collar code
              </Button>
              <Button variant="link" chevron href="/login" className={`${s.textLink} ${s.dOnly}`}>
                Become a feeder
              </Button>
            </div>
          </div>
          <div className={s.heroArt}>
            <MobilePhone />
            <DesktopArt />
          </div>
        </div>
      </Aurora>

      <section className={s.mist} aria-label="How Hetja works">
        <div className={`h-container ${s.mistGrid}`}>
          <SectionFade className={s.areaStats}>
            <Card className={s.statsCard}>
              <Label as="h2" className={`${s.statsLabel} ${s.mOnly}`}>
                Today in Mumbai
              </Label>
              <h2 className={`${s.statsTitle} ${s.dOnly}`}>Today in Mumbai.</h2>
              <div className={s.statsGrid}>
                <div>
                  <p className={s.statNum} data-testid="stat-dogs">
                    {dogs}
                  </p>
                  <p className={s.statLabel}>dogs with collars</p>
                </div>
                <div>
                  <p className={s.statNum} data-testid="stat-feeds">
                    {feeds}
                  </p>
                  <p className={s.statLabel}>feeds logged</p>
                </div>
              </div>
              <p className={s.joke}>Bruno was fed 3 times today. He will tell you it was zero.</p>
            </Card>
          </SectionFade>

          <SectionFade className={s.areaHead}>
            <h2 className={s.sectionTitle}>
              Three steps. <br className={s.mBr} />
              No app to install.
            </h2>
            <p className={`${s.sectionSub} ${s.dOnly}`}>
              It&apos;s a website. It works on the phone you already have.
            </p>
          </SectionFade>

          <SectionFade as="ol" className={s.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={s.step}>
                <div className={s.stepNum} aria-hidden="true">
                  {i + 1}
                </div>
                <h3 className={s.stepTitle}>{step.title}</h3>
                <p className={s.stepText}>{step.text}</p>
              </li>
            ))}
          </SectionFade>

          <SectionFade className={s.areaSide}>
            <h2 className={`${s.sectionTitle} ${s.peopleTitle} ${s.mOnly}`}>
              For the people who already show up.
            </h2>
            <Card className={s.roleCard}>
              <h3 className={s.roleTitle}>Feeders keep a streak.</h3>
              <p className={s.roleText}>
                <span className={s.mOnly}>
                  Log each feed in two taps. Other feeders on your lane see it, so nobody gets double
                  dinner. In theory.
                </span>
                <span className={s.dOnly}>
                  Two taps per feed. Others on your lane see it, so nobody gets double dinner. In
                  theory.
                </span>
              </p>
              <p className={s.streak}>
                <span className={s.streakNum}>23</span>
                <span className={s.streakUnit}>days</span>
              </p>
            </Card>
            <Card className={s.roleCard}>
              <h3 className={s.roleTitle}>Vets write it once.</h3>
              <p className={s.roleText}>
                <span className={s.mOnly}>
                  Medical records can&apos;t be edited or deleted. Corrections are added on top, with
                  a name and date.
                </span>
                <span className={s.dOnly}>
                  Medical records can&apos;t be edited or deleted. Corrections go on top, with a name
                  and a date.
                </span>
              </p>
              <div className={s.record}>
                <div className={s.recordRow}>
                  <b>Anti-rabies vaccine</b>
                  <span className={s.recordDate}>
                    12 Mar 2026<span className={s.dOnly}> · locked</span>
                  </span>
                </div>
                <div className={`${s.recordBy} ${s.mOnly}`}>Dr. A. Mehta · locked</div>
              </div>
            </Card>
          </SectionFade>
        </div>
      </section>

      <div className={s.bandWrap}>
        <PrivacyBand />
      </div>
    </>
  );
}
