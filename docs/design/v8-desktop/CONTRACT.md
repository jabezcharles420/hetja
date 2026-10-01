# Design v8: desktop pages, the map pins, and Credits

Owner handoff of 2026-10-01: two zips.

- **Hetja Design System.zip**: the design system the owner wants. It is the
  repo's own system recreated (tokens, components, guidelines) plus two new
  UI kits, `ui_kits/desktop` (desktop nav, ward map, the invitation) and
  `ui_kits/credits` (a 390 thank-you page). Copied here under `kit/`. Its
  fonts are not committed: SF Pro is under Apple's licence, and production
  already uses the system copy on Apple devices and Inter elsewhere.
- **stitch_hetja_design_system.zip**: the pages, in a design system the owner
  does not want (Material Symbols, a Material 3 palette, invented copy). It
  holds one built page, the desktop live map; its other nav items (How it
  works, About & Memorial, Vets & Feeders, Privacy & Ledger, Sign in) link
  nowhere. Copied here under `stitch/` for reference only. The design
  system's desktop kit says it replaces this mock, and it does.

## Owner decisions

1. **The map is a real desktop page.** Wider than 900px, `/map` shows its
   420px panel beside the map under the desktop nav, never the D1
   invitation (`ChromeShell`: `desktop: "none"`). This reverses v6 D1 for
   `/map` only; every other app route still shows the invitation.
2. **NGOs and vets show at every zoom.** They used to appear only from zoom
   13, so the city view a visitor lands on showed none and the map read as
   empty. They are mini pins below 13 (`components/map/logic.ts`
   `showPlace`, and `MapScreen` fetches them at every zoom).
3. **One desktop nav** (`components/DeskNav.tsx`, on `ds/TopNav`): logo,
   Map, How it works, Feeders, Vets, Privacy, Sign in, and the "Open on your
   phone" pill, which opens the invitation (`/`). Full width with 32px sides.
   On the map and on the invitation; the invitation hides the pill (it
   would open the page it is on).
4. **The invitation follows `kit/desktop/InviteScreen.jsx`**: the title on
   two lines, the new lead, the QR card ("On your phone", "Open the camera
   and point it at the code. No app to install.", "Or type hetja.in/<this
   page> into its browser."), today's count ("N dogs in Mumbai have a collar
   today. Each one has someone who noticed."), and two links, "See the city
   map here ›" and "The people who helped ›".
5. **Credits** (`/credits`, `kit/credits/CreditsScreen.jsx`): a focused
   screen with "‹ About", linked from About and from the invitation; in the
   480px column on a desktop.

## Deliberate departures from the kit

- **No placeholder names on Credits.** The kit's rows are all "[Name or
  group]". The three headings live in `apps/web/lib/credits.ts` with nobody
  under them yet, and a heading with nobody is not shown, so the page is the
  intro, the Hetja card and "Helped and not on this page?" until real names
  are added there.
- **The invitation's phone keeps the real dog** (the v7 decision "desktop
  real dog"): a public dog at ward level when one exists, else the labelled
  example. The kit draws the example Bruno with a collar code.
- **The count only shows when the API has one** (`/stats/impact`); the kit's
  "412" is example data.
- **The map panel keeps the v6 copy and buttons** ("Mumbai right now", "Scan
  a collar", "I can go and help"). The kit's panel ("Get alerts for your
  ward", the hungriest-wards list) is a sketch of the same panel, and on a
  desktop "Scan a collar" already hands over to the phone (it opens the
  invitation with a QR of the scanner).
- **Street tiles stay on** when `NEXT_PUBLIC_ESRI_API_KEY` is set (as in
  production). The kit draws the no-tiles fallback.
- **The reading pages are unchanged** (the 480px column on a desktop). Neither
  zip designs them for a desktop.
