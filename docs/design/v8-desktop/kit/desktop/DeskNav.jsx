const NS = window.HetjaDesignSystem_6e6e8c;
function DeskNav({ go, page }) {
  const { Logo, Button } = NS;
  const links = [["map", "Map"], ["how", "How it works"], ["feeders", "Feeders"], ["vets", "Vets"], ["privacy", "Privacy"]];
  return <header className="hc-nav desktop solid scrolled" style={{ position: "sticky", top: 0 }}>
    <div className="hc-nav-inner" style={{ maxWidth: "none", padding: "0 32px" }}>
      <a href="#" onClick={(e) => { e.preventDefault(); go("map"); }} className="hc-logo" style={{ gap: 9, fontSize: 21, fontWeight: 700, minHeight: 44 }}><NS.LogoMark size={30} /><span>Hetja</span></a>
      <nav className="hc-nav-right" aria-label="Main">
        <ul className="hc-nav-links">{links.map(([k, l]) => <li key={k}><a href="#" className="hc-nav-link" style={{ fontWeight: page === k ? 600 : 400 }} onClick={(e) => { e.preventDefault(); if (k === "map") go("map"); }}>{l}</a></li>)}</ul>
        <a href="#" className="hc-nav-signin">Sign in</a>
        <Button variant="navPill" onClick={() => go("invite")}>Open on your phone</Button>
      </nav>
    </div>
  </header>;
}
Object.assign(window, { NS, DeskNav });
