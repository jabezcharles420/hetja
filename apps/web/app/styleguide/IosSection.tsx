"use client";

import { useState } from "react";
import { castFor } from "@/lib/dogmoji";
import { Dogmoji } from "@/components/ui/Dogmoji";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  ActionSheet,
  ActivityRings,
  Bento,
  CompareTable,
  DueWidget,
  GroupedList,
  HungerSlider,
  IOSAlert,
  LargeTitle,
  ListIcon,
  ListRow,
  NearbyWidget,
  NotifStack,
  ScrollStory,
  SegmentedTabs,
  Sheet,
  StreakWidget,
  Tile,
  Toggle,
  WalletPass,
  WardMap,
  Widget,
  type Ring,
} from "@/components/ui/ios";

/**
 * Styleguide: iOS kit. Every element from the plan's "Apple element
 * inventory" rendered with real Hetja content, in the page rhythm the
 * landing will use: white → grey → white → black privacy band → white →
 * grey. Client component only because the demos (sheet, modal alert,
 * toggles) hold state; the kit itself is mostly server-safe.
 *
 * Layout helpers are a scoped <style> block with `sgi-` classes (CoreSection
 * uses `sg-`), so nothing here leaks into the kit.
 */

const SGI_CSS = `
.sgi-block { margin-top: clamp(48px, 6vw, 72px); }
.sgi-h3 { font-size: var(--h-t-xl); font-weight: var(--h-w-semibold); letter-spacing: -0.02em; margin: 0 0 18px; text-align: left; }
.sgi-settings { max-width: 620px; margin-inline: auto; padding: 28px 0; border-radius: var(--h-radius-tile); background: var(--h-ios-grouped); display: flex; flex-direction: column; gap: 28px; }
.sgi-settings > * { margin-inline: 16px; }
.sgi-center { display: grid; place-items: center; gap: 18px; }
.sgi-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; justify-content: center; }
.sgi-widgets { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; justify-content: center; }
.sgi-panel { background: var(--h-gray); border-radius: var(--h-radius-card); padding: 18px 20px; font-size: var(--h-t-sm); color: var(--h-ink-muted); text-align: left; }
.sgi-panel b { color: var(--h-ink); }
.sgi-wallpaper { border-radius: var(--h-radius-tile); padding: 24px 12px; background: linear-gradient(160deg, var(--h-aurora-3), var(--h-aurora-2)); display: grid; place-items: center; min-height: 260px; }
.sgi-lock { width: 56px; height: 56px; margin: 0 auto 22px; display: block; color: var(--h-on-dark); }
.sgi-trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 44px; margin-top: clamp(56px, 7vw, 88px); text-align: left; }
.sgi-trio h3 { font-size: 21px; font-weight: var(--h-w-semibold); letter-spacing: -0.015em; margin: 22px 0 0; }
.sgi-trio p { color: var(--h-on-dark-muted); margin-top: 8px; }
@media (max-width: 760px) { .sgi-trio { grid-template-columns: minmax(0, 1fr); gap: 36px; } }
.sgi-screen { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 54px 16px 20px; text-align: left; font-size: 15px; }
.sgi-screen h4 { margin: 0; font-size: 22px; font-weight: var(--h-w-bold); letter-spacing: -0.02em; }
.sgi-scan { flex: 1; position: relative; border-radius: 22px; background: linear-gradient(160deg, #3a3a3c, #1c1c1e); display: grid; place-items: center; min-height: 240px; }
.sgi-scan i { position: absolute; width: 36px; height: 36px; border: 4px solid #fff; }
.sgi-scan i:nth-child(1) { top: 26%; left: 22%; border-right: 0; border-bottom: 0; border-top-left-radius: 12px; }
.sgi-scan i:nth-child(2) { top: 26%; right: 22%; border-left: 0; border-bottom: 0; border-top-right-radius: 12px; }
.sgi-scan i:nth-child(3) { bottom: 26%; left: 22%; border-right: 0; border-top: 0; border-bottom-left-radius: 12px; }
.sgi-scan i:nth-child(4) { bottom: 26%; right: 22%; border-left: 0; border-top: 0; border-bottom-right-radius: 12px; }
.sgi-scan span { position: absolute; bottom: 14px; padding: 6px 12px; border-radius: 980px; background: var(--h-glass); -webkit-backdrop-filter: var(--h-blur); backdrop-filter: var(--h-blur); font-size: 13px; font-weight: 600; color: var(--h-ink); }
.sgi-profile { display: flex; align-items: center; gap: 12px; }
.sgi-profile b { display: block; font-size: 19px; }
.sgi-profile small { color: var(--h-ink-muted); font-size: 13px; }
.sgi-scene-bg { flex: 1; display: grid; place-items: center; padding: 54px 12px 20px; background: linear-gradient(160deg, var(--h-aurora-1), var(--h-aurora-2)); }
.sgi-logo { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #2c2c2e; color: #fff; }
.sgi-demo-note { font-size: var(--h-t-sm); color: var(--h-ink-muted); }
`;

const ROSTER = [
  { key: "bruno", status: "Fed 2h ago", tone: "ok" as const, sub: "Dadar West · outside Kirti College", nudge: undefined },
  {
    key: "biscuit",
    status: "Rabies due Fri",
    tone: "late" as const,
    sub: "Bandra West · Carter Road",
    nudge: (
      <>
        <b>Hetja:</b> Dr. Mehta has a slot Thursday 5 PM. Biscuit does not know.
      </>
    ),
  },
  { key: "kaalu", status: "2 days", tone: "warn" as const, sub: "Worli · night-shift regular", nudge: undefined },
  {
    key: "tommy",
    status: "Fed today",
    tone: "ok" as const,
    sub: "Andheri East · will sell you out for Parle-G",
    nudge: (
      <>
        <b>Hetja:</b> 3 feeders logged Tommy today. He&apos;ll tell you it was zero.
      </>
    ),
  },
];

const RINGS: Ring[] = [
  { label: "Feeds", value: 3, goal: 4, color: ["#e0004d", "#ff5e8a"] },
  { label: "Coverage", value: 60, goal: 100, color: ["#1f9e3a", "#6ee06b"], unit: "percent" },
  { label: "Streak", value: 36, goal: 30, color: ["#0093b8", "#3fe0e6"], unit: "days" },
];

export function IosSection(): React.JSX.Element {
  const [tab, setTab] = useState("dogs");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [lastAction, setLastAction] = useState("Nothing yet.");
  const [sosAlerts, setSosAlerts] = useState(true);

  const pick = (what: string): void => {
    setActionsOpen(false);
    setLastAction(`Picked: ${what}`);
  };

  const avatar = (key: string, size = 52): React.JSX.Element => <Dogmoji dog={castFor(key)} size={size} />;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SGI_CSS }} />

      {/* --- Lists ------------------------------------------------------- */}
      <section className="h-section h-section-center" aria-labelledby="sgi-lists">
        <div className="h-container">
          <span className="h-chip">iOS kit · Lists</span>
          <h2 id="sgi-lists" className="h-headline" style={{ marginTop: 22 }}>
            Dogs near you, sorted by last fed.
          </h2>
          <p className="h-lede">
            The roster card and the Settings list are one component. <strong>Hairlines start after the avatar.</strong>
          </p>

          <div className="sgi-block">
            <GroupedList variant="roster" aria-label="Dogs near you">
              {ROSTER.map((r) => {
                const dog = castFor(r.key);
                return (
                  <ListRow
                    key={r.key}
                    leading={avatar(r.key)}
                    title={dog.name}
                    subtitle={r.sub}
                    trailing={<StatusPill tone={r.tone}>{r.status}</StatusPill>}
                    nudge={r.nudge}
                  />
                );
              })}
            </GroupedList>
          </div>

          <div className="sgi-block sgi-settings">
            <GroupedList header="Notifications" footer="Alerts are ward-level. Hetja never shares where exactly a dog sleeps.">
              <ListRow
                leading={
                  <ListIcon bg="var(--h-danger-fill)">
                    <Icon name="siren" weight="fill" size={18} />
                  </ListIcon>
                }
                title="SOS alerts near me"
                trailing={
                  <Toggle
                    aria-label="SOS alerts near me"
                    checked={sosAlerts}
                    onChange={(e) => setSosAlerts(e.target.checked)}
                  />
                }
              />
              <ListRow
                leading={
                  <ListIcon bg="var(--h-warn)">
                    <Icon name="bell" weight="fill" size={18} />
                  </ListIcon>
                }
                title="Feeding reminders"
                trailing={<Toggle aria-label="Feeding reminders" defaultChecked />}
              />
              <ListRow
                leading={
                  <ListIcon bg="var(--h-safe)">
                    <Icon name="syringe" weight="fill" size={18} />
                  </ListIcon>
                }
                title="Vaccination due"
                trailing="2 days before"
                onClick={() => setLastAction("Opened: Vaccination due")}
              />
            </GroupedList>
            <GroupedList header="Your ward">
              <ListRow
                leading={
                  <ListIcon>
                    <Icon name="map-pin" weight="fill" size={18} />
                  </ListIcon>
                }
                title="Ward"
                trailing="Dadar West"
                href="/styleguide#sgi-lists"
              />
              <ListRow leading={avatar("moti", 36)} title="Moti" subtitle="Matunga · fed twice today" href="/styleguide#sgi-lists" />
              <ListRow title="Leave this ward" destructive onClick={() => setLastAction("Tapped: Leave this ward")} />
            </GroupedList>
            <p className="sgi-demo-note" aria-live="polite">
              Last row action: {lastAction}
            </p>
          </div>
        </div>
      </section>

      {/* --- Controls ---------------------------------------------------- */}
      <section className="h-section h-section-gray h-section-center" aria-labelledby="sgi-controls">
        <div className="h-container">
          <span className="h-chip">iOS kit · Controls</span>
          <h2 id="sgi-controls" className="h-headline" style={{ marginTop: 22 }}>
            Controls you already know how to use.
          </h2>
          <p className="h-lede">
            Segmented control, switch, sheet, alert, action sheet. <strong>Real inputs underneath, every one.</strong>
          </p>

          <Bento className="sgi-block">
            <Tile
              span={7}
              title="Segmented control"
              text="Arrow keys move and select. The thumb slides; it does not blink."
              visual={
                <SegmentedTabs
                  aria-label="Your activity"
                  items={[
                    { id: "dogs", label: "Dogs" },
                    { id: "feeds", label: "Feeds" },
                    { id: "badges", label: "Badges" },
                  ]}
                  value={tab}
                  onChange={setTab}
                  panels={{
                    dogs: (
                      <div className="sgi-panel">
                        <b>4 dogs</b> in your lanes. Bruno, Biscuit, Kaalu and Tommy.
                      </div>
                    ),
                    feeds: (
                      <div className="sgi-panel">
                        <b>3 feeds today.</b> Bruno at 7:10, Kaalu at 9:40, Bruno again at 13:05.
                      </div>
                    ),
                    badges: (
                      <div className="sgi-panel">
                        <b>36-day streak.</b> Longer than Bruno&apos;s attention span.
                      </div>
                    ),
                  }}
                />
              }
            />
            <Tile
              span={5}
              title="Switch"
              text="51 × 31, systemGreen, and a native checkbox."
              visual={
                <div>
                  <Toggle label="SOS alerts near me" description="Ward-level only" defaultChecked />
                  <Toggle label="Show me on the feeder map" description="Off by default" />
                  <Toggle label="Offline mode" disabled />
                </div>
              }
            />
            <Tile
              span={4}
              title="SOS confirm"
              text="A picture of an alert, for tiles. Screen readers get one sentence."
              visual={
                <IOSAlert
                  static
                  title="Send SOS for Bruno?"
                  message="Two vets and 11 feeders in Dadar West will be alerted."
                  actions={[
                    { label: "Cancel", style: "cancel" },
                    { label: "Send SOS", style: "destructive", preferred: true },
                  ]}
                />
              }
            />
            <Tile
              span={4}
              title="Collar mismatch"
              text="The Name Guard moment: the QR says Biscuit, the photo says Bruno."
              visual={
                <IOSAlert
                  title="This collar is Biscuit's"
                  message="You scanned Biscuit's collar, but you're on Bruno's page. Log the feed for Biscuit?"
                  actions={[
                    { label: "Cancel", style: "cancel", onPress: () => setLastAction("Mismatch: cancelled") },
                    { label: "Log for Biscuit", preferred: true, onPress: () => setLastAction("Mismatch: logged for Biscuit") },
                  ]}
                />
              }
            />
            <Tile
              span={4}
              title="Action sheet"
              text="Options stacked, Cancel on its own."
              visual={
                <ActionSheet
                  static
                  title="Bruno · Dadar West"
                  options={[{ label: "Log a feed" }, { label: "Add a photo" }, { label: "Report SOS", destructive: true }]}
                />
              }
            />
            <Tile
              span={12}
              title="Try them for real"
              text="The sheet drags to dismiss on a phone and becomes a card on a desktop. Escape closes everything; focus comes back here."
              visual={
                <div className="h-actions" style={{ justifyContent: "flex-start" }}>
                  <button type="button" className="h-btn h-btn-primary" onClick={() => setSheetOpen(true)}>
                    Log a feed
                  </button>
                  <button type="button" className="h-btn h-btn-ghost" onClick={() => setAlertOpen(true)}>
                    Show alert
                  </button>
                  <button type="button" className="h-btn h-btn-ghost" onClick={() => setActionsOpen(true)}>
                    Show action sheet
                  </button>
                  <span className="sgi-demo-note" aria-live="polite">
                    {lastAction}
                  </span>
                </div>
              }
            />
          </Bento>
        </div>
      </section>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Log a feed for Bruno"
        description="Dadar West · last fed 2h ago by Priya"
      >
        <GroupedList>
          <ListRow title="Food" trailing="Rice + curd" />
          <ListRow title="Water bowl refilled" trailing={<Toggle aria-label="Water bowl refilled" defaultChecked />} />
          <ListRow title="Looked healthy" trailing={<Toggle aria-label="Looked healthy" defaultChecked />} />
        </GroupedList>
        <button
          type="button"
          className="h-btn h-btn-primary h-btn-lg h-btn-block"
          style={{ marginTop: 20 }}
          onClick={() => {
            setLastAction("Feed logged for Bruno.");
            setSheetOpen(false);
          }}
        >
          Log feed
        </button>
      </Sheet>

      <IOSAlert
        modal
        open={alertOpen}
        title="Send SOS for Bruno?"
        message="Two vets and 11 feeders in Dadar West will be alerted."
        actions={[
          { label: "Cancel", style: "cancel", onPress: () => setAlertOpen(false) },
          {
            label: "Send SOS",
            style: "destructive",
            preferred: true,
            onPress: () => {
              setLastAction("SOS sent (not really, it's a styleguide).");
              setAlertOpen(false);
            },
          },
        ]}
      />

      <ActionSheet
        modal
        open={actionsOpen}
        title="Bruno · Dadar West"
        message="Last fed 2h ago"
        options={[
          { label: "Log a feed", onPress: () => pick("Log a feed") },
          { label: "Add a photo", onPress: () => pick("Add a photo") },
          { label: "Report SOS", destructive: true, onPress: () => pick("Report SOS") },
        ]}
        onCancel={() => setActionsOpen(false)}
      />

      {/* --- Glanceables ------------------------------------------------- */}
      <section className="h-section h-section-center" aria-labelledby="sgi-glance">
        <div className="h-container">
          <span className="h-chip">iOS kit · Glanceables</span>
          <h2 id="sgi-glance" className="h-headline" style={{ marginTop: 22 }}>
            Remembers every dog. So you don&apos;t have to.
          </h2>
          <p className="h-lede">
            Widgets, rings, a Wallet pass and a map. <strong>Each one is a summary you can read in a second.</strong>
          </p>

          <Bento className="sgi-block">
            <Tile
              span={7}
              gray
              title="The collar, as a pass."
              text="Tilt it with a mouse. The QR here is decorative; the real one is on the collar."
              visual={
                <div className="sgi-center">
                  <WalletPass
                    name="Bruno"
                    ward="Dadar West"
                    code="H7K-2QM"
                    vaccinated
                    avatar={avatar("bruno", 64)}
                    logo={
                      <>
                        <span className="sgi-logo" aria-hidden="true">
                          <Icon name="paw" weight="fill" size={16} />
                        </span>
                        Hetja
                      </>
                    }
                  />
                </div>
              }
            />
            <Tile
              span={5}
              gray
              title="Home-screen widgets."
              text="Small, medium, and a streak you will not want to break."
              visual={
                <div className="sgi-wallpaper">
                  <div className="sgi-widgets">
                    <StreakWidget days={36} caption="Hetja" />
                    <DueWidget dog="Biscuit" what="Rabies booster" when="Fri" caption="Hetja" />
                  </div>
                </div>
              }
            />
            <Tile
              span={6}
              gray
              title="3 dogs near you."
              text="Sorted by who is hungriest, not who is cutest."
              visual={
                <div className="sgi-wallpaper">
                  <NearbyWidget
                    ward="Dadar West"
                    caption="Hetja"
                    dogs={[
                      { name: "Bholu", avatar: <Dogmoji dog={castFor("bholu")} size={30} />, status: "9 AM", tone: "late" },
                      { name: "Kaalu", avatar: <Dogmoji dog={castFor("kaalu")} size={30} />, status: "2 days", tone: "warn" },
                      { name: "Bruno", avatar: <Dogmoji dog={castFor("bruno")} size={30} />, status: "2h ago", tone: "ok" },
                    ]}
                  />
                </div>
              }
            />
            <Tile
              span={6}
              gray
              title="Close your rings."
              text="Feeds today, ward coverage, streak. Past 100%, the ring laps itself."
              visual={
                <div className="sgi-center">
                  <ActivityRings rings={RINGS} size={168} legend />
                </div>
              }
            />
            <Tile
              span={4}
              gray
              title="Large widget."
              text="Any children, same frame."
              visual={
                <Widget size="large" tone="dark" aria-label="Today in Dadar West: 3 of 4 feeds, 60% coverage, 36-day streak">
                  <div aria-hidden="true" style={{ display: "grid", gap: 14, height: "100%", alignContent: "space-between" }}>
                    <b style={{ fontSize: 15 }}>Today · Dadar West</b>
                    <div style={{ display: "grid", placeItems: "center" }}>
                      <ActivityRings rings={RINGS} size={150} aria-label="Today's rings" />
                    </div>
                    <span style={{ fontSize: 13, color: "var(--h-on-dark-muted)" }}>Bruno ate 3 times. He disputes this.</span>
                  </div>
                </Widget>
              }
            />
            <Tile
              span={8}
              gray
              title="Ward, not street."
              text="Hetja coarsens every location to the ward. So does the map."
              visual={
                <WardMap
                  ward="Dadar West"
                  count={14}
                  footer={
                    <>
                      <b>Dadar West</b>14 dogs · 23 feeders · 2 vets on call
                    </>
                  }
                />
              }
            />
          </Bento>
        </div>
      </section>

      {/* --- Privacy band ------------------------------------------------ */}
      <section className="h-section h-section-dark h-section-center" aria-labelledby="sgi-privacy">
        <div className="h-container">
          <svg className="sgi-lock" viewBox="0 0 56 56" aria-hidden="true">
            <rect x="12" y="24" width="32" height="24" rx="6" fill="currentColor" />
            <path d="M19 24v-6a9 9 0 0 1 18 0v6" fill="none" stroke="currentColor" strokeWidth="4" />
          </svg>
          <h2 id="sgi-privacy" className="h-headline">
            Privacy. That&apos;s Hetja.
          </h2>
          <p className="h-lede">
            Dogs don&apos;t need an address. <strong>Neither do the people who feed them.</strong>
          </p>

          <div className="sgi-trio">
            <div>
              <NotifStack
                tone="dark"
                layout="list"
                items={[{ title: "Bruno was fed", body: "Dadar West · 2 min ago", time: "now", iconBg: "#ff9f0a", icon: "🐾" }]}
              />
              <h3>Coarsened to the ward.</h3>
              <p>A feed says Dadar West, never the lane. Nobody can use Hetja to find a dog, or you.</p>
            </div>
            <div>
              <NotifStack
                tone="dark"
                layout="list"
                items={[{ title: "Collar H7K-2QM scanned", body: "No name, no phone, no owner on the tag.", time: "9:41" }]}
              />
              <h3>Nothing personal on the collar.</h3>
              <p>The QR is a random code. It opens the dog&apos;s page, not yours.</p>
            </div>
            <div>
              <NotifStack
                tone="dark"
                layout="list"
                items={[
                  {
                    title: "Record added by Dr. Mehta",
                    body: "Rabies booster · verified vet",
                    time: "Tue",
                    iconBg: "var(--h-safe)",
                    icon: "✚",
                  },
                ]}
              />
              <h3>Medical records are append-only.</h3>
              <p>Vets add; nobody edits or deletes. Mistakes get a correction, in the open.</p>
            </div>
          </div>

          <div className="sgi-block sgi-center">
            <h3 className="sgi-h3" style={{ textAlign: "center" }}>
              A stack that fans out
            </h3>
            <NotifStack
              tone="dark"
              aria-label="Hetja notifications"
              items={[
                { title: "Biscuit: rabies due Fri", body: "Dr. Mehta has a slot Thursday 5 PM.", time: "now", iconBg: "var(--h-danger-fill)", icon: "💉" },
                { title: "Kaalu hasn't been fed in 2 days", body: "Worli · you fed him last Sunday.", time: "1h ago" },
                { title: "36-day streak", body: "Longer than Bruno's attention span.", time: "8:00", iconBg: "#ff9f0a", icon: "🔥" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* --- Toys -------------------------------------------------------- */}
      <section className="h-section h-section-center" aria-labelledby="sgi-toys">
        <div className="h-container">
          <span className="h-chip">iOS kit · Toys</span>
          <h2 id="sgi-toys" className="h-headline" style={{ marginTop: 22 }}>
            How hungry is Bruno?
          </h2>
          <p className="h-lede">
            Drag the slider. <strong>Bruno will always say he&apos;s starving.</strong>
          </p>
          <Bento className="sgi-block">
            <Tile span={6} gray title="Hunger control." text="Five stops, one honest dog." visual={<HungerSlider dog="Bruno" />} />
            <Tile
              span={6}
              gray
              title="Lock-screen stack."
              text="Hover, focus or tap to fan out."
              visual={
                <div className="sgi-wallpaper">
                  <NotifStack
                    items={[
                      { title: "Bruno was fed", body: "Priya · Dadar West · rice + curd", time: "now" },
                      { title: "Rabies due Fri", body: "Biscuit · Bandra West", time: "2h ago", iconBg: "var(--h-danger-fill)", icon: "💉" },
                      { title: "New dog in Colaba", body: "Rani was registered by Sameer.", time: "Mon", iconBg: "var(--h-safe)", icon: "🐶" },
                    ]}
                  />
                </div>
              }
            />
          </Bento>
        </div>
      </section>

      {/* --- Scroll story ------------------------------------------------ */}
      <section className="h-section h-section-gray" aria-labelledby="sgi-story">
        <div className="h-container">
          <div className="h-section-center">
            <span className="h-chip">iOS kit · ScrollStory</span>
            <h2 id="sgi-story" className="h-headline" style={{ marginTop: 22 }}>
              Three taps. One fed dog.
            </h2>
          </div>
          <div className="sgi-block">
            <ScrollStory
              steps={[
                {
                  id: "scan",
                  title: "Scan",
                  text: (
                    <>
                      Point your camera at the collar. <strong>No app to install.</strong>
                    </>
                  ),
                  visual: (
                    <div className="sgi-screen">
                      <h4>Scan a collar</h4>
                      <div className="sgi-scan">
                        <i />
                        <i />
                        <i />
                        <i />
                        <span>Hold steady on the QR</span>
                      </div>
                    </div>
                  ),
                },
                {
                  id: "see",
                  title: "See",
                  text: (
                    <>
                      Bruno. Fed 2h ago. Vaccinated. <strong>Everything a stranger needs, nothing more.</strong>
                    </>
                  ),
                  visual: (
                    <div className="sgi-screen">
                      <div className="sgi-profile">
                        {avatar("bruno", 56)}
                        <div>
                          <b>Bruno</b>
                          <small>Dadar West · H7K-2QM</small>
                        </div>
                      </div>
                      <GroupedList variant="inset" aria-label="Bruno's status">
                        <ListRow title="Last fed" trailing={<StatusPill tone="ok">2h ago</StatusPill>} />
                        <ListRow title="Rabies" trailing={<StatusPill tone="ok">Done</StatusPill>} />
                        <ListRow title="Sterilised" trailing="Yes" />
                      </GroupedList>
                    </div>
                  ),
                },
                {
                  id: "act",
                  title: "Act",
                  text: (
                    <>
                      Log a feed, or raise an SOS. <strong>One button, never two.</strong>
                    </>
                  ),
                  visual: (
                    <div className="sgi-scene-bg">
                      <IOSAlert
                        static
                        title="Feed logged"
                        message="Bruno's streak with you: 12 days."
                        actions={[{ label: "OK", preferred: true }]}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* --- Large title + compare -------------------------------------- */}
      <section className="h-section" aria-label="Large title demo">
        <div className="h-container h-container-narrow">
          <LargeTitle
            level={2}
            title="Your dogs"
            subtitle="Scroll past the title: a compact one appears in a glass bar under the nav."
            actions={
              <button type="button" className="h-btn h-btn-ghost h-btn-sm">
                Edit
              </button>
            }
          >
            <div className="sgi-settings" style={{ marginTop: 16 }}>
              <GroupedList>
                {["bruno", "biscuit", "kaalu", "moti", "rani", "tommy", "laddoo"].map((k) => {
                  const d = castFor(k);
                  return <ListRow key={k} leading={avatar(k, 36)} title={d.name} subtitle={`${d.ward} · ${d.tag}`} href="/styleguide" />;
                })}
              </GroupedList>
            </div>
          </LargeTitle>
        </div>
      </section>

      <section className="h-section h-section-gray h-section-center" aria-labelledby="sgi-compare">
        <div className="h-container">
          <h2 id="sgi-compare" className="h-headline">
            Which one is right for you?
          </h2>
          <div className="sgi-block">
            <CompareTable
              idPrefix="sgi-cmp"
              rowLabels={["Records", "Location", "SOS", "Cost"]}
              columns={[
                {
                  id: "hetja",
                  glyph: <span className="sgi-logo" style={{ width: 52, height: 52 }}><Icon name="paw" weight="fill" size={28} /></span>,
                  title: "Hetja",
                  subtitle: "For feeders",
                  cells: [
                    { bold: "Every feed, logged", detail: "Scan, tap, done." },
                    { bold: "Ward-level only", detail: "Never the lane." },
                    { bold: "Nearby vets alerted", detail: "In one tap." },
                    { bold: "Free", detail: "Always, for feeders." },
                  ],
                },
                {
                  id: "ngo",
                  glyph: "🏥",
                  title: "Hetja for NGOs & vets",
                  subtitle: "Verified partners",
                  cells: [
                    { bold: "Append-only ledger", detail: "Verified medical records." },
                    { bold: "Ward dashboards", detail: "Coverage at a glance." },
                    { bold: "Case queue", detail: "Triage by severity." },
                    { bold: "Free", detail: "For registered NGOs." },
                  ],
                },
                {
                  id: "nothing",
                  glyph: "🤷",
                  title: "Doing nothing",
                  subtitle: "The classic",
                  cells: [
                    { bold: "Vibes", detail: "And a WhatsApp group." },
                    { bold: "“Near the chai stall”", detail: "Which one?" },
                    { bold: "Hope", detail: "Someone else will call." },
                    { bold: "Free", detail: "Bruno disagrees." },
                  ],
                },
              ]}
            />
          </div>
        </div>
      </section>
    </>
  );
}
