const WARDS = [
  { k: "PN", code: "P/N", area: "Malad", x: 50, y: 16, dogs: 31, unfed: 4, sos: 0 },
  { k: "KW", code: "K/W", area: "Andheri West", x: 40, y: 45, dogs: 59, unfed: 5, sos: 1 },
  { k: "KE", code: "K/E", area: "Andheri East", x: 60, y: 50, dogs: 42, unfed: 3, sos: 0 },
  { k: "S", code: "S", area: "Bhandup", x: 80, y: 30, dogs: 18, unfed: 0, sos: 0 },
  { k: "HW", code: "H/W", area: "Bandra West", x: 36, y: 68, dogs: 27, unfed: 2, sos: 1 },
  { k: "L", code: "L", area: "Kurla", x: 63, y: 72, dogs: 22, unfed: 3, sos: 0 },
  { k: "A", code: "A", area: "Colaba", x: 33, y: 90, dogs: 12, unfed: 0, sos: 0 },
];
const PLACES = [{ t: "vet", x: 46, y: 40 }, { t: "vet", x: 30, y: 62 }, { t: "ngo", x: 45, y: 53 }, { t: "ngo", x: 68, y: 64 }];
const CHIPS = [["help", "Needs help", "alert"], ["unfed", "Not fed today", "clock"], ["vets", "Vets", "+"], ["ngos", "NGOs", "N"]];
function Chip({ on, label, icon, onClick }) {
  const { StatusIcon } = NS;
  const glyph = icon === "+" || icon === "N" ? <span style={{ width: 16, height: 16, borderRadius: "50%", background: on ? "#fff" : "var(--h-ink)", color: on ? "var(--h-ink)" : "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span> : <StatusIcon name={icon} size={16} />;
  return <button type="button" aria-pressed={on} onClick={onClick} style={{ height: 36, padding: "0 14px 0 10px", borderRadius: 999, border: 0, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--h-font)", fontSize: 14, fontWeight: 600, cursor: "pointer", background: on ? "var(--h-ink)" : "#fff", color: on ? "#fff" : "var(--h-ink)", boxShadow: on ? "none" : "inset 0 0 0 1px var(--h-divider)" }}>{glyph}{label}</button>;
}
function WardPill({ w, on, onClick }) {
  return <button type="button" onClick={onClick} style={{ position: "absolute", left: w.x + "%", top: w.y + "%", transform: "translate(-50%,-50%)", height: 40, padding: "0 12px 0 14px", borderRadius: 999, border: 0, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: "var(--h-font)", fontSize: 15, background: on ? "var(--h-ink)" : "#fff", color: on ? "#fff" : "var(--h-ink)", boxShadow: "var(--h-sh-chip)" }}>
    <b style={{ fontWeight: 700 }}>{w.code}</b><span style={{ color: on ? "var(--h-band-sub)" : "var(--h-secondary)" }}>{w.dogs}</span>
    {w.sos > 0 && <span style={{ height: 24, padding: "0 8px", borderRadius: 999, background: "var(--h-sos)", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center" }}>! {w.sos}</span>}
    {w.unfed > 0 && <span style={{ height: 24, padding: "0 8px", borderRadius: 999, background: "var(--h-warn-bg)", color: "var(--h-warn)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}><NS.StatusIcon name="clock" size={12} />{w.unfed}</span>}
  </button>;
}
function CityPanel({ pick }) {
  const { Label, ListRow, Button } = NS;
  const hungry = [...WARDS].sort((a, b) => b.unfed - a.unfed).slice(0, 4);
  return <>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Label>Mumbai right now</Label>
      <h1 style={{ fontSize: 34, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.03em" }}>2 dogs need help.<br /><span style={{ color: "var(--h-secondary)" }}>17 are waiting for dinner.</span></h1>
    </div>
    <p style={{ fontSize: 17, lineHeight: 1.47, color: "var(--h-text-mid)" }}>Nobody has logged K/E since this morning. If you're near Andheri East tonight, someone there would be glad of you.</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Label>Hungriest wards</Label>
      <div style={{ background: "var(--h-mist)", borderRadius: 20, padding: "0 16px" }}>
        {hungry.map((w) => <ListRow key={w.k} density="compact" onClick={() => pick(w.k)} title={w.code + " ward"} sub={w.area} trailing={<NS.StatusPill variant="warn" icon="clock" size="row">{w.unfed} not fed today</NS.StatusPill>} />)}
      </div>
    </div>
  </>;
}
function WardPanel({ w, back }) {
  const { Label, ListRow, Button, StatusPill, DogAvatar } = NS;
  return <>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <a href="#" onClick={(e) => { e.preventDefault(); back(); }} style={{ fontSize: 17, minHeight: 44, display: "inline-flex", alignItems: "center", alignSelf: "flex-start", margin: "-8px 0 -4px" }}>‹ Mumbai</a>
      <h1 style={{ fontSize: 40, lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em" }}>{w.code} ward</h1>
      <p style={{ fontSize: 17, color: "var(--h-secondary)" }}>{w.area} · {w.dogs} dogs with collars</p>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {w.sos > 0 && <StatusPill variant="danger" icon="alert" size="row">{w.sos} needs help</StatusPill>}
      {w.unfed > 0 && <StatusPill variant="warn" icon="clock" size="row">{w.unfed} not fed today</StatusPill>}
      <StatusPill variant="ok" icon="check" size="row">{w.dogs - w.unfed - w.sos} fed today</StatusPill>
    </div>
    {w.sos > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Label>Open case</Label>
      <div style={{ background: "var(--h-danger-bg)", borderRadius: 20, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <DogAvatar id="sheru" name="Sheru" palette="sky" size={44} />
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 600 }}>Sheru can't get up</div><div style={{ fontSize: 14, color: "var(--h-danger)" }}>Can't get up, or bleeding · 13 min ago</div></div>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.45, color: "var(--h-text-mid)" }}>Priya and Arjun have been told. Nobody is on the way yet. The exact spot unlocks for whoever takes it.</p>
      </div>
    </div>}
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Label>Nearby</Label>
      <div style={{ background: "var(--h-mist)", borderRadius: 20, padding: "0 16px" }}>
        <ListRow density="tall" title="Dr. Mehta, Pet Clinic" sub="Vet · K/W ward · open till 9 pm" trailing={<Button variant="tinted">Call</Button>} />
        <ListRow density="tall" title="Andheri Animal Rescue" sub="NGO · K/W ward · ambulance" trailing={<Button variant="tinted">Call</Button>} />
        <ListRow density="tall" title="BMC Veterinary Dispensary" sub="Government vet · free" trailing={<Button variant="tinted">Call</Button>} />
      </div>
    </div>
  </>;
}
function MapScreen({ go }) {
  const { Button } = NS;
  const [ward, setWard] = React.useState("KW");
  const [chips, setChips] = React.useState({ help: true, unfed: true, vets: true, ngos: true });
  const w = WARDS.find((x) => x.k === ward);
  const open = w && w.sos > 0;
  return <div style={{ position: "relative", height: "calc(100vh - 53px)", minHeight: 760, display: "grid", gridTemplateColumns: "420px 1fr" }}>
    <aside style={{ background: "#fff", boxShadow: "1px 0 0 var(--h-divider)", display: "flex", flexDirection: "column", minHeight: 0, zIndex: 2 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 28px 20px", display: "flex", flexDirection: "column", gap: 22 }}>
        {w ? <WardPanel w={w} back={() => setWard(null)} /> : <CityPanel pick={setWard} />}
        <p style={{ fontSize: 13, lineHeight: 1.45, color: "var(--h-secondary)" }}>Dogs are shown by ward, never by street. Vets and NGOs are public places, so they get a pin.</p>
      </div>
      <div className="hc-sf divider white" style={{ padding: "14px 28px 20px" }}>
        {open ? <Button fullWidth>I can go and help</Button> : <Button fullWidth>{w ? "Get alerts for " + w.code + " ward" : "Get alerts for your ward"}</Button>}
        <p className="hc-sf-cap">{open ? "You'll see the exact spot once you say you're going." : "We'll only tell you about dogs in wards you pick."}</p>
      </div>
    </aside>
    <section style={{ position: "relative", background: "var(--h-mist)", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 24, top: 20, display: "flex", gap: 8, zIndex: 3 }}>
        {CHIPS.map(([k, l, ic]) => <Chip key={k} on={chips[k]} label={l} icon={ic} onClick={() => setChips((c) => ({ ...c, [k]: !c[k] }))} />)}
      </div>
      {WARDS.filter((x) => (chips.help && x.sos) || (chips.unfed && x.unfed) || (!x.sos && !x.unfed) || x.k === ward).map((x) => <WardPill key={x.k} w={x} on={x.k === ward} onClick={() => setWard(x.k)} />)}
      {PLACES.filter((p) => (p.t === "vet" ? chips.vets : chips.ngos)).map((p, i) => <span key={i} title={p.t === "vet" ? "Vet" : "NGO"} style={{ position: "absolute", left: p.x + "%", top: p.y + "%", width: 26, height: 26, borderRadius: "50%", background: p.t === "vet" ? "var(--h-blue)" : "var(--h-ink)", color: "#fff", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 3px #fff, var(--h-sh-chip)" }}>{p.t === "vet" ? "+" : "N"}</span>)}
      <div style={{ position: "absolute", right: 20, bottom: 16, height: 32, padding: "0 14px", borderRadius: 999, background: "rgba(255,255,255,.92)", fontSize: 13, color: "var(--h-secondary)", display: "flex", alignItems: "center", boxShadow: "inset 0 0 0 1px var(--h-divider)" }}>Street map unavailable. Wards are shown at their centres.</div>
    </section>
  </div>;
}
window.MapScreen = MapScreen;
