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

6. **Every page in the Stitch nav is a desktop page** (2026-10-01, "it has
   all desktop pages that need to be added"):
   - **How it works, About, FAQ, Privacy, Contact**: from 1024px the desktop
     nav (with the "Open on your phone" pill), the 1080px column, titles from
     72px, card lists as grids of up to four, desktop cards (radius 32,
     padding 32), the desktop footer (`components/Content.module.css`, the
     "Desktop" block; `ChromeShell` reading pages `desktop: "none"`).
   - **Feeders and vets** (`/join`, new): Stitch's "Vets & Feeders". One
     section per role (feeders, vets, NGOs), each ending in that role's real
     next step (`/welcome`, `/vet/apply`, `/ngo/register`); on a desktop those
     open the invitation with a QR of the step. The nav's Feeders and Vets
     link to `#feeders` and `#vets` here.
   - **About & Memorial**: About as above; `/hetja` in its own centred 640px
     column instead of the 480px frame.
   - **Sign in** (`/login`): a 480px card on mist (`desktop: "card"`), no
     longer the invitation, so a laptop can sign in. Admin sign-in uses it
     too. The app screens after it are still the invitation on a desktop.

7. **The Stitch map page's content is kept, all of it, in the design
   system** (owner, 2026-10-01: "all those desktop content was important to
   me, I just wanted the design of the other zip"). The desktop map's panel
   is `components/map/DeskPanel.tsx`; the phone sheet is unchanged.
   - Header: the logo with "Mumbai canine ledger", Live map, How it works,
     About & memorial, Vets & feeders, Privacy & ledger, Sign in (or the
     account avatar), "Open on phone" (a QR dialog on the map).
   - City panel: "Mumbai right now" with the IST clock, the two-line
     headline ("N dogs need help." / "N waiting for dinner."), the Collars,
     Hungry and SOS tiles, the chips All wards, SOS (n), Unfed (n), Vets (n),
     NGOs (n), the open cases, the hungriest wards, and the panel foot
     "Field actions happen on the street" with the collar lookup.
   - Ward panel: "Back to all of Mumbai", the ward's name, its code and dog
     count, the needs-care / not-fed / fed pills, each open case card (what
     happened, the dog, how long ago, respond through the phone's own flow,
     Share), the feeding round with its progress bar and goal, the vets and
     shelters near the ward with Call, and the dogs with collars, each fed or
     waiting.
   - Map: the layer tabs (Live feed, Ward view, Care network), zoom, the
     ward pills, NGO and vet pins with "24h" where they are open round the
     clock, and the sources line (it opens the credits).
   - Dialogs: "Look up a collar" (code, the dog, its ward, vaccination and
     last feed, "Open health ledger") and "Open on your phone" (the QR).
   - Footer (map and reading pages, `components/DeskFooter.tsx`): the
     "Hetja network" blurb, Network index and Civic ledger columns, the
     dedication, the copyright.

   Changed from Stitch, each because the original would be false or unsafe:
   - **No street on an SOS** ("Reported near Lokhandwala Complex, 2nd Cross
     Road", "Bleeding · Lokhandwala Jcn" on the map). INVARIANT 2: a case is
     "in K/W ward"; the exact spot unlocks only for whoever takes it. A
     public street address for a hurt dog is what a poisoner would want.
   - **No NFC.** Hetja collars are QR only, so "tap an NFC collar", "NFC
     Mesh" and "NFC Collar Verification" became the typed code and "Collar
     verification".
   - **No "BMC Ward Sync" / "Hetja Node #04" / "Blockchain".** None exists.
     The layer tabs became the map's real layers; the sources line names the
     real sources; the footer badge reads "Ward level, never street".
   - **No scheduled rounds or assigned volunteers** ("Scheduled 19:30",
     "Pooja M., Sunil R. assigned"). Hetja has neither; the card is today's
     real feeding count, naming the dogs not logged yet.
   - **"Verified safe" is "fed today"**, which is what the data says.
   - **No zone** ("Zone IV"): the contracts carry no BMC zones, and a wrong
     one would be worse than none.
   - **Example numbers are live numbers** (59 collars, 17 hungry, 12 vets):
     the panel counts what is on the map now.
   - Labels are sentence case (the design system's rule), and the
     "Response vehicle en route" line became who has been told and whether
     anyone has taken the case.

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
- **The reading pages are built from the design system's rules**, not a
  mock: neither zip draws them for a desktop (Stitch only names them in its
  nav). See decision 6.
