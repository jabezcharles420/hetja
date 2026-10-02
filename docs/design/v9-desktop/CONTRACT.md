# Design v9: the desktop site

Owner handoff of 2026-10-01: **Hetja Desktop.html**, a Claude Design export
(a self-unpacking bundle, kept out of the repo for its 9 MB of fonts). Its
nine pages, rendered at 1440, are in `boards/`: home, how, about, join,
privacy, faq, contact, credits, hetja. It supersedes the v8 desktop nav,
footer and invitation (`docs/design/v8-desktop`); the v8 desktop map and its
Stitch content stay.

## How it is built

- From **1024px** every page in the export is a desktop page. Each app page
  renders its phone layout and its desktop layout side by side
  (`components/desk/DeskSwitch.tsx`, `data-layout="phone" | "desk"`), and
  CSS shows one, so the server renders the right one with no flash. The
  phone pages are untouched.
- The desktop layouts: `components/desk/DeskPages.tsx` (How it works, About,
  Vets & feeders, Privacy, FAQ, Contact, Credits), the invitation
  (`components/DesktopInvite.tsx`, the export's "Home A"), the memorial's
  desktop block (`app/hetja/hetja.module.css`). Words are the export's,
  verbatim (`components/desk/content.ts`); FAQ reads `app/faq/questions.ts`
  and the memorial its own page, so phone and desktop cannot drift.
- One header (`components/DeskNav.tsx`, 56px, frosted), one footer
  (`components/DeskFooter.tsx`), and one pair of dialogs for the whole
  desktop site (`components/desk/DeskDialogs.tsx`): "Look up a collar"
  (type the code, the dog appears, "Open Rosie on phone") and "Open on your
  phone" (a QR of this page, or of the dog's page). The header's two
  actions, the home page's links, the role cards and the map's panel all
  open these.

## Owner decisions in the export

- Nav: How it works, About, Vets & feeders, Privacy, FAQ, "Look up a
  collar", "Open on phone". Footer: eight links in three columns, "Ward
  level, never street · AGPL-3.0 free software", "© 2026 Hetja · Source on
  GitHub".
- Home is the invitation ("Home A"); the export's "Collar first" variant is
  not built (it is an option in the export, not the default).
- "Start feeding on your phone" and "Sign records on your phone" open the QR
  dialog; "Bring your NGO to Hetja" is a mail to hello@hetja.in with
  "Partnerships" in the subject.
- Credits is a desktop page with the header and footer (not the 480px
  column of v8). The memorial keeps its own calm page.

## Deliberate departures from the export

- **"Live map" leads the nav.** The export has no map page, but the desktop
  map (design v8) is a real page with the Stitch content the owner asked to
  keep; without the link it would be unreachable. The map uses the same
  header and dialogs.
- **The phone on the home page shows a real dog** (as v7 and v8 decided),
  with its own pills: "Not fed today" only when it has not been logged
  today in Mumbai, "Vaccinated" or "Vaccination unknown", and its collar
  code. The export's Rosie is example data. With no public dog, the
  labelled example (Rani) stands in.
- **"Or type" names the page's own address** (hetja.in/scan on /scan), as in
  v8; the export writes hetja.in on home.
- **The lookup asks Hetja**, not a fixed list: any real collar code finds its
  dog. "Try C3D I5E SH8" in the export becomes "The 9 letters printed under
  the QR."
- **The memorial's top bar** is its existing back link, not the export's
  "‹ About" plus logo; the masthead, essay column and songs follow the
  export.
- **Type renders in Inter on Windows and Android** (SF Pro on Apple), so a
  title the export sets in two lines can wrap to three there.
