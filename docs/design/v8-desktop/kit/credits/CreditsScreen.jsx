const CREDIT_GROUPS = [
  ["On the street", [["[Name or group]", "Fed the first dogs with collars, every evening"], ["[Name or group]", "Walked a ward and checked every tag"]]],
  ["Checked the details", [["[Name or group]", "Called vets and NGOs to confirm their numbers"], ["[Name or group]", "Read the first-aid lines as a practising vet"], ["[Name or group]", "Placed directory entries in the right ward"]]],
  ["Lent a hand", [["[Name or group]", "Printed and laminated tags at cost"], ["[Name or group]", "Tested the collar page on an old phone in the rain"]]],
];
function CreditsScreen() {
  const { AppHeader, Label, LogoMark } = NS;
  const [scrolled, setScrolled] = React.useState(false);
  return <>
    <AppHeader back={{ label: "About" }} surface="mist" sticky={false} scrolled={scrolled} />
    <Scroll style={{ padding: "16px 20px 48px", gap: 18 }}>
      <div onScroll={() => {}} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 style={{ fontSize: 44, lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.04em" }}>Thank you.</h1>
        <p style={{ fontSize: 18, lineHeight: 1.45, color: "var(--h-secondary)" }}>Hetja was built by a few people and kept alive by many more. Most of them never wrote a line of code. They just kept showing up.</p>
      </div>
      <a href="#" style={{ background: "var(--h-memorial-bg)", borderRadius: 20, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, color: "var(--h-ink)", boxShadow: "inset 0 0 0 1px var(--h-memorial-divider)" }}>
        <span style={{ color: "var(--h-text-mid)" }}><LogoMark size={36} /></span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontFamily: "var(--h-serif)", fontSize: 19 }}>Hetja</span><span style={{ fontSize: 14, color: "var(--h-secondary)" }}>Who walked three kilometres in the rain. This is for her.</span></span>
        <span style={{ fontSize: 20, color: "var(--h-tertiary)" }}>›</span>
      </a>
      {CREDIT_GROUPS.map(([g, rows]) => <section key={g} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Label as="h2" style={{ padding: "0 4px" }}>{g}</Label>
        <ul style={{ listStyle: "none", margin: 0, background: "#fff", borderRadius: 20, padding: "0 16px" }}>
          {rows.map(([n, s], i) => <li key={i} style={{ minHeight: 64, padding: "10px 0", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderTop: i ? "1px solid var(--h-divider)" : 0 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{n}</span><span style={{ fontSize: 15, lineHeight: 1.3, color: "var(--h-secondary)" }}>{s}</span></li>)}
        </ul>
      </section>)}
      <p style={{ fontSize: 15, lineHeight: 1.45, color: "var(--h-text-mid)", padding: "0 4px" }}>Helped and not on this page? Write to <a href="mailto:hello@hetja.in">hello@hetja.in</a> and a person will put you here.</p>
      <p style={{ fontSize: 13, color: "var(--h-secondary)", textAlign: "center", paddingTop: 8 }}>Free, open source, built in Mumbai.</p>
    </Scroll>
  </>;
}
window.CreditsScreen = CreditsScreen;
