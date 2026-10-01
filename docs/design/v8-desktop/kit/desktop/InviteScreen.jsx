function InvitePhone() {
  const { StatusPill } = NS;
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
    <div role="img" aria-label="An example of a dog's page" style={{ position: "relative", width: 336, height: 668, borderRadius: 52, background: "#fff", boxShadow: "0 0 0 10px var(--h-ink), 0 40px 80px rgba(0,0,0,.22)", overflow: "hidden", padding: "48px 18px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)", width: 92, height: 26, borderRadius: 14, background: "var(--h-ink)" }}></div>
      <div style={{ height: 180, flex: "none", borderRadius: 22, background: "var(--h-av-apricot-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 72, fontWeight: 700, color: "var(--h-av-apricot-ink)", letterSpacing: "-0.035em" }}>B</div>
      <div style={{ fontSize: 30, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.03em" }}>Bruno</div>
      <div style={{ fontSize: 14, color: "var(--h-secondary)", marginTop: -6 }}>K/W ward · Andheri West</div>
      <div style={{ display: "flex", gap: 6 }}><StatusPill variant="ok" icon="check" size="small">Vaccinated</StatusPill><StatusPill variant="ok" icon="check" size="small">Sterilised</StatusPill></div>
      <div style={{ background: "var(--h-mist)", borderRadius: 14, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--h-secondary)" }}>Collar code</div>
        <div style={{ fontFamily: "var(--h-mono)", fontSize: 22, fontWeight: 600, letterSpacing: ".06em", display: "flex", gap: 10 }}><span>DDR</span><span>017</span><span>XK2</span></div>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.45 }}>Bruno turned up in 2019 and decided the lane was his.</div>
      <div style={{ marginTop: "auto", marginBottom: 22, height: 48, flex: "none", borderRadius: 999, background: "var(--h-sos)", color: "#fff", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>This dog needs help</div>
    </div>
    <p style={{ fontSize: 14, color: "var(--h-secondary)" }}>An example of a dog's page.</p>
  </div>;
}
function InviteScreen({ go }) {
  const { Aurora, Label, Button } = NS;
  return <Aurora variant="desktop" style={{ minHeight: "calc(100vh - 53px)" }}>
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 20px 64px", display: "grid", gridTemplateColumns: "minmax(0,1fr) 400px", gap: 80, alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <h1 style={{ fontSize: 88, lineHeight: .94, fontWeight: 700, letterSpacing: "-0.055em" }}>Hetja lives on your phone.</h1>
        <p style={{ fontSize: 23, lineHeight: 1.4, color: "var(--h-secondary)", maxWidth: 560 }}>It's made for the street. <span style={{ color: "var(--h-ink)" }}>A laptop can't follow a dog down a lane, but the phone in your pocket can.</span> Point its camera here and this page opens there, right where you left it.</p>
        <div style={{ display: "flex", gap: 24, alignItems: "center", background: "#fff", borderRadius: 32, padding: 24, maxWidth: 560 }}>
          <div aria-label="QR code of this page" style={{ width: 148, height: 148, flex: "none", borderRadius: 20, background: "var(--h-mist)", boxShadow: "inset 0 0 0 1px var(--h-divider)", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 13, color: "var(--h-secondary)", padding: 16 }}>QR of this page</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Label>On your phone</Label>
            <p style={{ fontSize: 17, lineHeight: 1.47 }}>Open the camera and point it at the code. No app to install.</p>
            <p style={{ fontSize: 15, color: "var(--h-secondary)" }}>Or type <b style={{ color: "var(--h-ink)", fontWeight: 600 }}>hetja.in/map</b> into its browser.</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <span style={{ fontSize: 72, lineHeight: .9, fontWeight: 700, letterSpacing: "-0.06em" }}>412</span>
          <span style={{ fontSize: 19, color: "var(--h-secondary)", paddingBottom: 4 }}>dogs in Mumbai have a collar today. Each one has someone who noticed.</span>
        </div>
        <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
          <Button variant="link" chevron onClick={() => go("map")}>See the city map here</Button>
          <Button variant="link" chevron href="../credits/index.html">The people who helped</Button>
        </div>
      </div>
      <InvitePhone />
    </div>
  </Aurora>;
}
window.InviteScreen = InviteScreen;
