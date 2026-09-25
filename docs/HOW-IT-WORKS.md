# Hetja: what it is, and how it actually works

This document is the one to read first. The [README](../README.md) says *why*
Hetja exists; [AGENTS.md](../AGENTS.md) says how to get it running on a fresh
machine; [INVARIANTS.md](INVARIANTS.md) lists the fifteen rules the system is
not allowed to break. This one explains the thing itself: what happens when a
stranger scans a dog's collar, what happens when they say the dog is hurt, and
what is holding all of that up.

Where something is designed but not built, it says so. There is no value in a
document that describes an aspiration as if it were running.

---

## 1. The one-sentence version

A street dog wears a collar with a QR code. Anyone who finds the dog (no app,
no account, no login) scans it with their phone's camera and gets a page that
tells them who this dog is, whether it is vaccinated, when it was last fed, and
a single large button: "This dog needs help". One more tap to say how bad it is
and one to send, and the nearest vets, NGOs and ambulances are on their screen
with tappable phone numbers, while the people nearby who have said they will
help are woken up.

Everything else in the repository exists to make those two screens true.

---

## 2. The people involved

Hetja has four kinds of user, and they do not share an interface. That
separation is deliberate; see §4.

**The stranger.** Someone who happens to find a dog. They are the only user who
matters at the moment of an emergency, they will never install anything, they
may be panicking, and they may be on a bad connection on a Mumbai street. They
get one page, no account, and are never asked to sign in. Ninety percent of all
traffic is this person.

**The feeder.** Someone who feeds and watches over specific dogs in their area.
They sign in (emailed code, no passwords, no SMS), log feeds, upload photos,
and can be woken by an SOS near them or in the wards they chose. They accumulate a *trust score* over
time, which is what earns them the right to do higher-stakes things.

**The responder.** A feeder, NGO worker or vet who has opted in to being
notified about emergencies in a geofenced area. When an SOS opens, they get a
push notification. The first one to acknowledge it owns the case; everyone else
is told to stand down so five people don't drive to the same dog.

**The tagger.** NGO or municipal staff who physically put collars on dogs and
enrol them into the system. This is a small number of trained people doing
bulk data entry, which is a completely different job from everything above.

---

## 3. The flows that matter

### 3.1 Scan

A collar's QR encodes a URL:

```
https://hetja.in/d/<slug>?s=<signature>
```

`slug` is nine characters from a deliberately reduced alphabet
(`[a-km-z2-9]`: no `l`, no `0`, no `1`) so a human can read one off a collar
and type it in without ambiguity. It is **random**, not sequential: you cannot
enumerate the city's dogs by counting upward (INVARIANT 1).

`s` is `base64url(HMAC-SHA256(qr_secret, slug))`. The server recomputes it and
refuses to resolve a slug whose signature doesn't match, which means a printed
collar cannot be forged and a scraper cannot fabricate valid URLs. The secret
lives only in the server's environment and in one row of the database, never
in any client bundle.

Two paths reach that URL, and both work:

- **The phone's own camera app.** This is the normal path and requires nothing
  from us. iOS Camera and Android's viewfinder both recognise a QR and offer to
  open the link.
- **In-page, from hetja.in/scan.** `apps/web/components/QrScanner.tsx` (screen
  02) opens the camera as soon as the page loads, because the design says so
  ("It opens by itself. No button needed.") and because someone who tapped
  **Scan a collar** has already asked for the camera. This reverses the earlier
  rule of asking only behind a "Use camera" button; the permission prompt now
  follows an explicit tap on the home page rather than a cold visit. It uses
  the native `BarcodeDetector` where it exists and lazily imports the small
  `barcode-detector` polyfill elsewhere. If permission is denied or there is no
  camera, the sheet under the viewfinder offers the code instead. A scanned
  code is checked against `GET /api/v1/dogs/:slug` before leaving the page.

When a QR will not read (mud, glare, a chewed tag), the scan tab does not
leave the finder stuck. After six seconds without a read the sheet becomes
"Can't read this QR." (F1) with three ways on:

- **Type the code** (`/scan/code`). One field, or three boxes of three when
  only part of the code is legible (F2): `?`, `.` or a space stands for a
  character that cannot be read. `GET /api/v1/dogs/lookup` folds the usual
  slips before it searches (case; `0` as `o`; `1` and `l` as `i`), needs at
  least four known characters, and answers with the exact dog, the dogs that
  match the known characters, and, for a full nine-character miss, the dogs
  one swap or one character away. A near miss is shown as a question with the
  dog's photo ("One letter off. Is it her?", V3: "Yes, that's Rani" or "Not
  her. Type it again"), not as an error.
- **Find by ward and photo** (`/scan/find`, F3). `GET /api/v1/wards/:wardId/dogs`
  lists the ward's collared dogs (at most 30), narrowed by coat colour, from
  the visitor's location, their home ward or a picked ward. A stranger picks
  the dog by its face.
- **Dog is hurt · Send SOS anyway**: the SOS with no known dog, §3.2.

Both finding reads hand out slugs by design, so they are active and lost dogs
only, ward-level only, and rate limited per device (or per address when there
is no device yet) under a global daily bucket each; INVARIANTS.md #6 records
why those per-address limits are allowed.

The page that opens (screen 03, polished as V15) shows the dog's photo (or its
initial on a pastel circle), name, ward (`K/W ward · Andheri West`),
vaccinated and sterilised status, its feeders, its story and the collar code.
Status comes only from vet-recorded evidence: vaccinated is "yes" or
"unknown", sterilised is "yes", "no" or "unknown", and "no" is never shown
without evidence. What the page deliberately does **not** show is the dog's
exact location or anyone's phone number (INVARIANTs 2 and 3). Locations are
coarsened to the ward before they reach an anonymous viewer, because a precise
live location for a street dog is a targeting tool for anyone who wants to hurt
it, and there are such people.

**Feeders are named by first name, and can opt out.** Until design v6 the page
gave counts only. By the owner's decision it now names the dog's feeders
("Tells Priya, Arjun and a vet nearby.") by the first word of their display
name and nothing more: never a surname, an initial, an account or a contact.
Settings has "Show my first name on dogs' pages", on by default; a feeder who
turns it off is counted ("Rani has 2 feeders") and not named. INVARIANTS.md
records this as a deliberate widening of what INVARIANT 3 protects.

The page also says what Hetja is unsure of. A dog nobody has vouched for yet
carries an **Unverified** badge until a vet records a checkup or a second
feeder confirms it (§3.8). A tag someone reported as being on the wrong dog
says so ("A feeder will check it. SOS still works."). A dog whose tag keeps
breaking suggests a sturdier collar. A dog that has died keeps a quiet
memorial page with the first names of the people who fed it, and no SOS
button (§3.9). If the page has been opened before on this phone, a saved copy
opens offline and says when it was saved. And the red button is live before
the page has finished loading (P7): a tiny inline script records the tap and
the SOS module replays it.

**An unknown code is not an outage** (P8). When `GET /dogs/:slug` answers 404,
the page says "Hetja doesn't know this collar.", offers to type the code again
or find the dog by photo, and keeps SOS live as a dogless SOS to the visitor's
ward. Only a real failure to reach Hetja shows "Can't reach Hetja right now".
Those two used to look the same (docs/BUGS.md, 2026-09-25).

On a desktop wider than 744 px the collar page shows its own QR, so the visitor
can carry it to a phone, with the SOS button still working (D2).

A dog whose registration is still `pending_activation`, or has `expired`, is
not public at all: `GET /api/v1/dogs/:slug` answers 404 for it, except to the
registrator who filed it. That was a real bug until 2026-09-24 (see
[BUGS.md](BUGS.md)).

A signed-in feeder who scans with the phone camera also gets a quiet "Feeding
{Name}? Log a feed" link under the SOS button. Strangers see nothing extra, and
the SOS stays the one loud action.

### 3.2 Danger

On the collar page there is one primary action: **{Name} needs help** ("This
dog needs help" when the page does not know the dog). It opens a whole-screen
step (screen 04, polished as V18, "What's happened to {Name}?") with three
choices, which map onto the API's severity enum in `apps/scan/src/format.ts`:

| The stranger picks | Severity sent |
|---|---|
| "Hurt, but moving" (limping, a wound, not eating) | `serious` |
| "Can't get up, or bleeding" (needs a vet now) | `critical` |
| "Something else" (missing, scared, or being harmed) | `serious` |

The screen never sends `minor`. **Send SOS** stays disabled until a choice is
made. A note and a photo are optional; the photo is EXIF-stripped on
the server and saved only for a case the request actually opened, and it is
not part of the report's dedupe key, so a different photo cannot mint a "new"
case around the INVARIANT 7 cap.

Before the browser's own location prompt, the page asks in words, once
("Share where you are, once.", N12). Location is optional for a known dog and
required for a dogless SOS. If it is refused, the report is not lost (P12,
"Not sent yet."): the reporter can copy the details, share location and send,
or send to the dog's feeders only. With no signal at all (P13) the message is
already written: **Open Messages** opens the phone's SMS app with the text
filled in and no recipient, the saved vet numbers are offered as recipients,
and the page sends it itself when the signal comes back. Hetja never holds a
feeder's number, so an SMS "to Rani's feeders" is impossible by design.

The send is one `POST /api/v1/reports`, and the answer carries two things.

**Who to phone.** The response includes `nearbyCare`: up to eight providers
near the dog (free NGOs, government facilities, charity hospitals, and paid
clinics), each with a tappable number, whether they have an ambulance, whether
they are open 24×7, and what they cost. The sent screen (05) lists them as
Call rows. If the dog has no position on file, or the report itself failed,
the page falls back to `GET /api/v1/care` from the visitor's own location, and
if that is impossible too it says so and gives honest guidance, never a
made-up number. With no signal at all, it offers a prefilled text message
instead. This is a change from the earlier design, where the call list
appeared the instant the button was pressed and did not wait for the report;
the v4 flow puts one choice in between, and every degraded path still ends in
something the caller can act on.

The ordering is the interesting part. Providers with genuinely geocoded
coordinates come first, sorted by true distance. Providers whose coordinates
are only a locality-centroid estimate come after, and are sorted by
**has_ambulance → cost_tier (free before subsidised before paid) → open 24×7 →
name** rather than by distance. Distance is omitted entirely for those rows and
a place name is shown instead.

That is not fussiness. Twenty-five of the seeded Mumbai organisations collapse
onto eighteen distinct coordinates, because they were estimated from ward
centroids rather than geocoded from addresses. Sorting by that distance
produced a confident-looking "BHL Bird Helpline: 0 m away". Someone reading
that skips a hospital that is actually closer. `distanceM` is now `null`
unless the coordinate is real, and the API states which contract applies via
`geoPrecision`. **A measurement we don't have is not reported as zero.**

Phone numbers carry the same honesty rule. `phone_verified_at` is surfaced to
the client, not collapsed into a boolean, so a number nobody has ever called is
never presented as fact. The web app's map and its SOS with no dog show such
a number *as unconfirmed*. **The collar page, since
v6 (V19), goes further and hides it**: its "Can't wait? Call" rows, and the
numbers it saves for a no-signal SOS, are confirmed numbers only, and a place
that is closed keeps its row but loses its Call button. That makes the
monthly confirmation of the list (`import-care.ts`, VET-DATA-INTAKE.md) a
precondition for the collar page offering anyone to call at all: with no
confirmed number near the dog, the reporter sees no Call rows. About thirty of
the seeded NGO numbers are still `NULL` here. Someone has to pick up a phone
and call them; there is no way to shortcut that.

**An SOS case.** The same request creates a case. For a "Can't get up, or
bleeding" (`critical`) report on a dog that is eligible for paging, the API
picks responders there and then and the worker pushes to them. A responder is
a feeder with SOS paging on, not paused, and trusted enough for the severity
(`lib/sos-eligibility.ts`, one rule for the fan-out, the ack and the map),
who is either near the dog (a geotagged feed within 2 km in the last 30 days)
or, if they chose wards in Settings, feeds in the dog's ward. **Wards drive
paging** since design v5: a feeder with wards set is paged only for dogs in
those wards, and for any dog in them, recent feed or not; a feeder with no
wards is paged by proximity as before. At most 15 are paged. Quiet hours
never hold back an SOS. This is rate-capped, because an unauthenticated
endpoint that can notify unbounded numbers of people is a harassment vector
(INVARIANT 7). If no eligible responder exists, the case escalates to tier 2
immediately rather than waiting out a timer: the three nearest contracted vets
and the municipal desk get notification rows (a record, not yet a delivery,
so they are not counted as told; see §9). A `serious` report ("Hurt, but
moving", "Something else") notifies the dog's own feeders at report time,
whatever their trust score, and escalates after eight minutes unless someone
has taken it. Taking a case still needs the trust floor. The reporter's
screen always leads with numbers to call.

`POST /api/v1/sos/cases/:id/ack` (**I'm going**) claims a case. It is a
conditional update (`WHERE acked_by IS NULL AND resolved_at IS NULL`), so the
first writer wins atomically, a closed case can never be walked back open,
and everyone else gets a 409 and a stand-down. Only a paged responder, a
moderator, or a feeder who meets the responder rule may take one, at most two
open at a time. This is what makes the programme's headline metric (median
acknowledgement under five minutes) measurable at all.

**The responder's page** (`/sos/<caseId>`, where the push lands) follows the
case through its life, one layout per state:

- **Open** (P9): the dog, its photo, the reporter's note and photo, the ward,
  how far away (rounded to 100 m, from the responder's own last scan), who
  else was told, when it escalates, and **I'm going**. The quiet link "I
  can't go right now" declines the page (`/decline`); it never changes the
  escalation clock. An escalated case (L5) says so; a case someone else took
  (L4) names them by first name and stands the viewer down.
- **Taken, yours** (P10): **the exact spot unlocks only now**, with a street
  map and Directions ("The exact spot unlocks when you tap I'm going"). Before
  taking a case nobody sees finer than the ward (INVARIANT 2). From here: "Tell
  the reporter you're close" (`/close-by`), "With Rani" when there
  (`/arrived`), and "I can't make it after all" (`/release`), which hands the
  case back to open, pages the others again (not the releaser, not anyone who
  declined) and leaves the escalation clock where it was.
- **Closing** (P11): the outcome, **Taken to a vet** (with the vet's name),
  **Treated on the spot**, **Couldn't find the dog** or **She didn't make it**
  (`/resolve` with `outcome`; the older `resolved` and `false_alarm` still
  work). "Didn't make it" files a pending passed-away report for the dog and
  opens Update on a dog, where a second feeder confirms it (§3.9). A closed case (V21) shows its timeline.
- **Not for you** (V22): a signed-in feeder who may not respond sees why, as
  the real checklist from the responder rule (paging on, trust, a feed nearby
  or the ward), not a bare 403. A page that fails to load (L6) says so and
  offers the vets.

Every step is also an event in `sos_case_events` (migration 0027), which is
what the timeline on both sides is built from.

**The reporter can follow the case** (V19, N10, N11). While the screen is
visible, the reporter's phone polls `GET /api/v1/reports/:caseId/status` every
15 seconds, for at most an hour. The route answers only the device token (or
signed-in account) that filed the report, gives the same 404 for "not yours"
as for "does not exist" so case ids cannot be probed, and is rate-limited per
device, not per IP (INVARIANT 6). Since v6 it says who was told (feeders by
first name, opt-outs respected, and a count of vets), and once someone takes
the case, their first name and when they took it, came close and arrived:
"Priya is on the way." It never says where the responder is. While waiting
the reporter sees three first-aid lines (N10, `apps/scan/src/firstaid.ts`:
keep traffic back, don't lift a dog that can't stand or give food or water,
keep your hands away from its face), shipped by the owner's decision and
still due a vet's review (OWNER-TODO). They can **Send Priya an update**
(`POST /reports/:caseId/updates`, 280 characters) or say **I had to leave**
(`/left`). The outcome closes the screen (N11). A phone that already has an
open case on the dog and tries again is shown that case, who took it and when,
with "Add an update", instead of a bare refusal (L7).

**An SOS with no known dog** (P8, F1). The pipeline used to need a dog: its
feeders were the people to page. Designed twice (F1 on the scan tab, P8 on an
unknown collar), it is now built. `POST /api/v1/reports` without a `dogSlug`
needs a point inside Mumbai (400 `GEO_REQUIRED` or `GEO_OUTSIDE_MUMBAI`
otherwise). The case is stamped with the nearest ward (`sos_cases.ward_id`)
and keeps the point (`sos_cases.geo`, migration 0027), which, like a dog's
exact spot, only the responder who takes it ever sees. It is paged exactly like
a dog at that point, by ward and proximity, and escalates to the vets nearest
the point. Its limits are stricter than a dog report's, on top of INVARIANT 7:
2 then 3 a day per device or account, 3 then 6 a day per address, and one open
dogless case per reporter per ward. On the web the path is **Dog is hurt · Send
SOS anyway** (`/scan/find?sos=1`, `components/scan/SosAnyway.tsx`), which also
lists the nearest vets and NGOs with Call buttons whatever happens.

### 3.3 Feed

Signed-in feeders log a feed on screen 06 (`/feed?dog=<code>`). The photo is
optional now, and so is "How did it go?": **Ate it all**, **Ate a little**,
**Didn't eat**, **Looks unwell**. The choice is stored as
`scans.feed_outcome` (`ate_all`, `ate_some`, `didnt_eat`, `unwell`; migration
`0024`), written only when the scan row is first created, so an offline replay
can never rewrite it (INVARIANT 5). Older rows and feeds without a choice stay
`NULL`, because there is nothing true to backfill with.

"Looks unwell" is a **flag for a human, never an action**. The screen suggests
raising an SOS and does not raise one; the server never opens a case from it
(INVARIANT 14), and it does not touch `review_status`, because INVARIANT 15
counts rejected and flagged scans toward pausing a feeder, and reporting a sick
dog must never count against the person who reported it. Feeds go through the
same offline queue as before, and a signed-in response includes the feeder's
streak so the screen can say "Keeps your streak at N days" truthfully.

Design v6 added three things around the same write. A feed can carry a short
**note** (`scans.note`, 280 characters, migration 0027). On "Looks unwell" a
signed-in feeder can **tell the dog's other feeders** (`tellCoFeeders: true`):
one push to them, at most a few a day per dog, still never an SOS. And a
feeder on a round can open `/feed` without a dog, tick everyone they fed
("Who did you feed?", V11) and send them in one `POST /api/v1/scans/batch` (up
to 12, each under exactly the single-feed rules). With no signal the screen
says how many feeds are waiting (N7). After a first feed the phone is offered
"Add to home screen" (V23), which is what makes Web Push work on an iPhone.
A feed or view scan of a dog marked lost puts it back to active (§3.9).

Each feeder also has a private **week view** per dog (`/me/dogs/<code>`, N15,
`GET /api/v1/dogs/:slug/week`, feeders of the dog only): which of the last
seven Mumbai days it was fed and by whom (first names), the rabies booster
date, and how many vet records it has.

### 3.4 Map

`/map` (screen 19) shows all of Mumbai, and only Mumbai. Its data is three
public reads in `apps/api/src/routes/map.ts`:

- `GET /api/v1/map/wards`: every BMC ward with three counts (active dogs, dogs
  not fed since midnight in Mumbai, open SOS cases) and the newest open case's
  severity and time, at a **fixed, hand-placed ward centre**
  (`BMC_WARD_CENTROIDS` in `@hetja/contracts`). The point is the same for every
  request, so it cannot leak where any dog, reporter or feeder is. Since v6 it
  also carries the city summary for "Mumbai right now" (M1, V20): dogs with
  collars, feeders, fed today, not logged today, and the open SOS rows with
  the dog's name and whether someone has taken it.
- `GET /api/v1/map/wards/:wardId`: one ward's counts, its open cases (severity,
  time, state and whether responders were paged; no note, no reporter, no
  photo, no position), up to three vets and NGOs in or near it, and since v6
  the first names of its dogs and the ones not logged today with when they
  last were (M2, M6). Still ward level: a name beside a ward, never a street.
- `GET /api/v1/map/places?bbox=`: listed vets and NGOs with a real geocoded
  point inside a box, for pins. A provider whose position is only a locality
  estimate never gets a pin, because it would be drawn in the wrong place.
  The client nudges a pin clear of a ward label on screen (it is never moved on
  the ground), and a place sheet says "open now" only where the hours are
  structured enough to compute it (M5); otherwise it shows the hours note.

**Everything about dogs is aggregated to the ward** (INVARIANT 2). The only
phone numbers are organisations' published numbers from `care_providers`
(INVARIANT 3). The reads are 60-second caches.

**Case ids are not public.** Taking a case (`POST /sos/cases/:id/ack`) is first
writer wins, so publishing ids on an anonymous map would let any new account
claim every open case and stop it escalating. The ward detail returns a case id
only to a signed-in caller who meets the same responder rules the fan-out uses
(SOS paging on, trust 40 or more, 60 for critical) or who already holds the
case; that answer is per caller and never cached. That is what makes the map's
**I can go and help** button safe (M4 is the taking step; signed out, M3 says
what signing in unlocks). **Get alerts for {ward} ward** sets the feeder's
home ward and turns SOS paging on (`PATCH /api/v1/feeders/me`). Paging follows
the wards a feeder chose in Settings or on Become a feeder (§3.2, §3.10), as
well as recent feeds near the dog.

The vets and NGOs on the map are Hetja's own list, refreshed monthly from a CSV
of details confirmed with each provider (`packages/db/src/import-care.ts`, run
through the `care-import.yml` workflow, dry-run by default; retired rows are
unlisted, never deleted). Google Maps is used only to find leads; Google Places
content is never stored, per Google's terms. See
[VET-DATA-INTAKE.md](VET-DATA-INTAKE.md).

Base tiles are Esri's Light Gray static basemap (ArcGIS Location Platform, a
referrer-restricted key in `NEXT_PUBLIC_ESRI_API_KEY`), on `/map` and on the
responder's SOS page. There is **no keyless fallback**: CARTO's keyless tiles
now answer 200 with an "API key required" image, and OpenStreetMap's own
tiles are ruled out for a production app by their usage policy. With no key,
or once Esri has refused three tiles before any loaded, there is no tile layer; the
map says "Street map unavailable. Wards are shown at their centres." and the
ward pills and pins still work on a plain background. A map that says it has
no streets is better than one drawn full of an error image.
**Mumbai only.** `MUMBAI_BOUNDS` in `packages/contracts/src/wards.ts`
(18.88 to 19.30 N, 72.76 to 73.00 E) is the whole world as far as the map is
concerned: the tile layer is bounded to it (no tile outside Mumbai is ever
requested), the view cannot be panned past it, and `/api/v1/map/places`
clamps any box to it and answers 400 for a box entirely outside it.

### 3.5 Registration and activation

A feeder registers a dog they look after from `/register`. The first time,
that screen (V13) explains what it takes, including "About ₹150" for a collar,
and turns registering on for the account; after that it lists their
registrations (V12) as sentences sorted by what needs doing. `/register/new`
is one client flow in four steps:

1. **Photo** (R2): a face photo, compressed and EXIF-stripped on the phone.
   It becomes the dog's portrait (`photoBase64` on `POST /registrations`,
   through the same photo gate as every upload).
2. **Is this dog already registered?** (R3): the collared dogs already in the
   dog's ward (`GET /wards/:wardId/dogs`). "Same dog" opens that dog's page
   instead of minting a second code: one dog, one code.
3. **About the dog** (R4): name, sex, how to spot it (markings, at most 8
   short words, which the finding screens show), and whether it is
   vaccinated and sterilised as far as the registrator knows.
4. **Check and confirm** (R5).

The self-reported medical answers are stored as `dogs.vaccinated_reported`
and `dogs.sterilised_reported` (migration `0025`) and are **never read by any
public route**. The profile's Vaccinated and Sterilised pills come only from
vet-verified medical records, which is what the screen's caption promises:
"Vets can confirm medical status later."

An account and a phone may each hold two dogs waiting for their collars at a
time, and at most six registrations a week. At the limit, `/register/new`
opens on "Two collars waiting" (P6), naming the dogs that hold the slots,
rather than failing at the end of the form.

The code is ready at once (V14, "Kalu is almost on Hetja."): the real signed
QR, an Unverified pill and the activation line. **The dog stays invisible
until its tag is scanned next to it.** `/register/<code>` (P1) is the
registrator's checklist, with a countdown to expiry and a full-screen scanner;
the scan it takes is checked first (`POST /registrations/:slug/tag-check`),
and a wrong tag is named with both dogs and both codes (P2) instead of being
silently accepted. Only then does the page ask for location, and activation
itself is the geotagged `POST /scans` it has always been. After it, "Collar is
live" (P3), and from then on the same route manages the dog (P4): its page,
reprint, edit, who feeds it, and Update on a dog. A registration nobody
activates expires after 30 days, with reminders on day 7 and day 21
([FEATURE-GUIDE.md](FEATURE-GUIDE.md) Part 2 §5 has the state machine).

### 3.6 Printing a tag

`/register/<code>/print` (R7 merged with P5) starts with the material:

- **Paper, laminated**: the R7 layouts, "10 small tags + collar band" or "1
  large tag + wall notice", on A4 or Letter, with a live preview; or "Add to
  a batch sheet", which goes to `/register/batch` (R8), up to eight of the
  registrator's dogs, two tags each, on one page (`POST /collars/batch` signs
  them in one call). **Download PDF** builds a real vector PDF in the browser
  (`apps/web/lib/collar-pdf.ts`, pdf-lib, dynamic-imported), because the room
  cannot afford server-side rendering. Each QR is one filled path of module
  rectangles at exact millimetres (version 5, 0.49 mm a module on the 22 mm
  tag, well inside what a phone reads), and the text uses the PDF standard
  fonts, so a sheet is a few KB. A dog's name in Devanagari is drawn with an
  embedded subset of Noto Sans Devanagari, fetched only then. **Send to a
  print shop** hands the same PDF to the Web Share API, and downloads it
  where a phone cannot share files, saying so. If the PDF cannot be built,
  the HTML sheet at `./sheet` prints at real size.
- **Laser on TPU**: the 40 x 40 mm laser sheet that was already there, with
  the print-shop specification from P5 (TPU Shore 95A, laser-etched with no
  ink, QR version 5 ECC M, 37 modules, 4-module quiet zone).

The QR is always the signed collar URL, never the mock's unsigned
`HTTPS://HETJA.IN/D/<CODE>`: collar QRs are HMAC-signed (§3.1). Every print
is recorded (`POST /dogs/:slug/prints`, table `tag_prints`) for the dog's tag
history, and a reprint for a damaged or lost tag closes that report.

### 3.7 When a tag breaks

Anyone holding the dog's page can **Report a tag problem** (F4): damaged or
faded, found it on the ground, this isn't the dog in the photo, or the collar
is too tight. No sign-in: `POST /dogs/:slug/tag-reports` takes a device token,
is limited per device, per dog and per address, and keeps only a hash of the
device for its 24-hour dedupe. The dog's feeders get a push, and the reporter
is told what to do with the tag (F5).

"This isn't the dog in the photo" puts the tag **under review**: the page says
so, and feeds on that code earn no trust until a feeder checks. **SOS is never
paused.** The mock said "Feeds and SOS on that code pause"; the build does
not, because an anonymous report must not be able to switch off SOS for a dog.

A feeder of the dog handles it from `/me/dogs/<code>/tag` (F6): reprint (the
print screen, preloaded), "I have a spare", or, for a wrong-dog report,
"checked, it's fine". The review clears once no wrong-dog report is left
open. Three different reporters in seven days suggest a sturdier collar, on
the feeder's page and on the dog's.

### 3.8 Verified dogs

A registration proves one person stood next to a dog once. The page says
**Unverified** until someone independent vouches for it (`dogs.verified_at`,
`verified_via`, migration 0026):

- **A second feeder** (`POST /dogs/:slug/confirm`): a signed-in feeder of the
  dog who is not its registrator, not on the registering phone, and has fed
  it recently. My dogs lists the unverified dogs a feeder could confirm.
- **A vet** (`/vet/<code>`, N3, `POST /dogs/:slug/checkups`, vet accounts in
  the contracted-vets registry only): rabies given today, up to date or due;
  sterilised; next vaccine due month; a note for feeders; and "I examined this
  dog". Nothing is preselected. It is written through the one ledger writer,
  so it is append-only and hash-chained (INVARIANTs 8 and 9), and it is what
  turns the page's Vaccinated and Sterilised pills on.

### 3.9 Not seen, adopted, passed away

A feeder of the dog files **Update on a dog** (`/me/dogs/<code>/status`, N9,
`POST /dogs/:slug/status-reports`, table `dog_status_reports`):

- **Not seen** marks the dog `lost` and asks that ward's feeders to look out.
  Any later feed or view scan puts it back to `active`.
- **Adopted, or in a shelter** marks it `adopted`.
- **Passed away** waits for a second, different feeder to confirm within 30
  days, then marks it `deceased`. An SOS closed as "didn't make it" files the
  first report for the responder.

A deceased dog's page becomes a memorial: "{Name} has passed away. Her page
stays, with the names of everyone who fed her.", the first names of its
signed-in feeders (opt-outs respected), no SOS button. That list is the one
public place names appeared before v6 made them general (§3.1).

### 3.10 Alerts, quiet hours and a pause

**Become a feeder** (`/welcome`, N1) runs once after the first sign-in: the
name other feeders see, up to six wards ("We only alert you about dogs in
these wards.", and that is exactly what paging does, §3.2), SOS alerts, and
quiet hours. The same settings live in **Settings** (`/settings`, N6), with
the name opt-out, a download of the account's own data
(`GET /feeders/me/export`, JSON) and **Delete my account**
(`DELETE /feeders/me`), which anonymises: the name becomes "Former feeder",
the identity HMAC, wards, sessions and push subscriptions go, and the dogs and
feed logs stay, because other people's care depends on them.

- **Alerts** (`/alerts`, N5, `GET /feeders/me/alerts`): the last 14 days,
  newest first, at most 50: SOS cases, tag reports, verifications, feeds by
  others, not-seen reports and status changes on the feeder's dogs, each
  linking to its screen. It is a row on Me with an unread count, not a tab.
- **SOS only or all** (`alertsMode`): with SOS only, the worker's
  `send_feeder_push` job skips every other push.
- **Quiet hours** (`quietHours`, Mumbai time): every push except an SOS is
  held until the window ends.
- **Pause** (L1, `sosPausedUntil`, at most 30 days): turning the SOS switch
  off on Me offers "Pause until tomorrow" (8 am Mumbai time), "Pause for a
  week" or "Turn off". A paused feeder is not paged for a new case; their consent is not
  changed by it. Turning alerts on asks for notification permission with
  Hetja's own explanation first (N13).

---

## 4. The four apps, and why they are separate

```
apps/
  scan     vanilla TypeScript, no framework      -> hetja.in/d/<slug> (profile + SOS)
  web      Next.js 14 App Router                 -> hetja.in (everything else, incl. /map)
  api      Fastify 5 + zod                       -> hetja.in/api/v1, api.hetja.in
  worker   background jobs (SOS fan-out, escalation, push, expiry, retention)
  shell    native wrapper: EMPTY, not built
  ai       vision/embedding helpers
packages/
  contracts  zod schemas and ward data shared by API and clients; the single source of truth
  db         pool, migrations, slug generation and signing, care-directory importers
  design     tokens.css: the design v4 tokens from the Claude Design handoff, plus v5's few additions
  ledger     hash-chained append-only medical ledger
  pow        ALTCHA proof-of-work solver for anonymous device tokens
```

The split is about failure domains, not tidiness.

`apps/scan` is the life-safety surface. It is plain TypeScript with no
third-party runtime dependency (only the repo's own proof-of-work solver),
held under a **40 KB gzipped CI budget** that fails the build if exceeded,
because the person using it is on a phone on a street and every kilobyte is a
second. The v6 screens brought it to 39,101 of 40,960 bytes; three cuts paid
for them (build-time HTML minification, 20 rarely used ASCII symbols dropped
from the Inter subset, and the `web-vitals` package replaced by the browser's
own `PerformanceObserver`), and there is about 1.9 KB left. It runs as its own service (`hetja-scan`), so a crash in
the web app or the API's heavier routes cannot take down the page a stranger
needs. It does ship in the same release tarball as everything else, so a bad
release is health-checked and rolled back as a whole.

`apps/web` is everything else: the scan tab and finding a dog, logging feeds,
signing in, Me with its alerts, settings and dogs, registering and printing,
the responder's SOS page, the vet's checkup, the map, and the marketing and
reading pages. Richer, heavier, and allowed to be. It has four tabs (Home,
Map, Scan, Me), and on a desktop wider than 744 px every app route shows an
invitation to open it on a phone instead (reading pages, `/hetja` and
`/sos/**` open in a 480 px column; the print sheets are left alone). `/hetja` is the memorial page. `/privacy` is a DPDP notice and is
treated as a factual document: when the login moved from phone to email, that
page had to change in the same commit, because a privacy notice that describes
storage you no longer do is simply false.

`apps/field`, the tagger portal, was the original name for a bulk-enrolment
surface gated on `feeder_role` (`admin`/`vet`/`bmc_officer`). It is not a
separate app. The **registrator surface that ships in `apps/web` plus
`POST /api/v1/registrations` *is* that portal**: sign up → register the dog you
look after → print the collar (`docs/MAKING-A-COLLAR.md`) → attach it → scan it
to activate. `POST /api/v1/dogs` (admin enrolment, `apps/api/src/routes/enrolment.ts`)
exists and is the operator counterpart. What remains unbuilt from the original
`apps/field` scope is the **re-tag route**: a replacement collar keeps the same
slug (`GET /api/v1/registrations/:slug` returns the same `collarUrl` forever), but
there is no dedicated retag endpoint yet. Trust ≥ 50 would have locked out pilot
staff who need to retag on day one, which is why access gates on role, not score.

---

## 5. Data

Twenty-six domain tables plus `schema_migrations` in PostgreSQL 16, with PostGIS
for geography and pgvector for image embeddings. Fifteen of them come from
`0001_init.sql`; `care_providers` (0008), `otp_codes` (0010),
`push_subscriptions` (0011), `web_vitals` (0013), `refresh_tokens` (0017),
`spent_challenges` (0021), `collar_reissues` (0023), `tag_reports`,
`tag_prints` and `dog_status_reports` (0026, design v5) and `sos_case_events`
(0027, design v6) arrived later. Earlier versions of this paragraph said
"eighteen", then "nineteen" (which omitted the 0017 and 0021 tables), then
"twenty-two", while `WORK-REPORT.md` said "15". None matched the database for
long, which `\dt` counts even higher because PostGIS ships its own
`spatial_ref_sys`. The count is checkable:
`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN
('schema_migrations', 'spatial_ref_sys')`. Migrations `0024` and `0025` added
columns, not tables: `scans.feed_outcome` and
`dogs.vaccinated_reported` / `dogs.sterilised_reported` (§3.3, §3.5). `0026`
and `0027` also added columns: a feeder's wards, quiet hours, alerts mode,
onboarding, deletion, name opt-out and alerts pause; a dog's markings,
verification, tag review and vaccine due month; a declined page; and a case's
note, ward, point, outcome, vet name and lifecycle times. `sos_cases.dog_id`
became nullable for the dogless SOS, with a check that a case has a dog, or a
ward and a point. All of it is additive. The ones to know:

| Table | What it holds |
|---|---|
| `dogs`, `collars` | the register; a collar binds a slug to a dog |
| `scans` | every resolution of a slug, coarsened |
| `feeders` | accounts; identified by `identity_hmac`, never a raw address |
| `medical_records` | append-only, hash-chained treatment ledger |
| `sos_cases`, `sos_notifications` | the case machine and its delivery receipts |
| `sos_case_events` | a case's lifecycle after the ack: released, close by, arrived, reporter updates, reporter left |
| `tag_reports`, `tag_prints` | reported tag problems (reporter device stored only as a hash) and every print, for a dog's tag history |
| `dog_status_reports` | not seen, adopted, passed away, and who confirmed it |
| `care_providers` | the public vets/NGO directory behind the danger flow |
| `vets` | *contracted* partner clinics: signing keys, MOUs, retainers |
| `geofences`, `feeder_territories` | who gets woken for what |
| `trust_events` | the audit trail behind every trust score |
| `otp_codes`, `push_subscriptions` | login codes and push endpoints |

Two of those distinctions carry weight.

**`care_providers` is not `vets`.** `vets` is a contractual registry: it has
`signing_key_pub NOT NULL`, `mou_signed_at`, `retainer_paise`. Those columns
are meaningless for an NGO we have no relationship with and merely *list*. So
listing lives in its own table, with one optional bridge (`vet_id`) for the
case where a listed provider also happens to be a contracted partner.

**`medical_records` is append-only, and enforced twice.** On a self-hosted
database (CI, tests, the old box), `UPDATE` and `DELETE` are revoked from the
application role. On Supabase, which is production, a `BEFORE UPDATE OR DELETE`
trigger blocks it for *every* role including the owner. Each record carries the hash of the
previous one, so an altered history fails verification even if someone gets
write access to the table (INVARIANT 9). A dog's treatment history is evidence
in a cruelty case; it has to be worth something in front of someone who doesn't
trust us.

---

## 6. Auth, and why there is no SMS

Login is a six-digit code emailed to the feeder. No passwords, no phone
numbers, no SMS. SMS costs money per message, and this has to run on nothing.
Email goes out via Brevo's permanent free tier (300/day) from
`no-reply@hetja.in`, with SPF, DKIM and DMARC on the domain so it lands in
inboxes rather than spam.

Codes live in Postgres, hashed (`SHA-256(pepper:code)`), with a five-minute TTL
and three attempts. They used to live in an in-memory `Map`, which lost every
pending code on restart and could not work with more than one process. In
production the API now **refuses to boot** without SMTP credentials rather than
starting up and silently sending nothing, which was the original bug, and the
kind that surfaces only when a real person cannot log in.

Contact information is never stored raw. `identity_hmac` is
HMAC-SHA256 of the address under a server-held pepper (INVARIANT 3). Not a bare
hash: an email address has little enough entropy that a plain SHA-256 of it is
reversible with a wordlist.

Anonymous clients that need to write (a stranger reporting an injury) get a
*device token* minted by `POST /api/v1/devices/challenge` + `/token` against an
ALTCHA v2 proof-of-work (an HMAC-signed, single-use challenge solved
client-side), so the write endpoints are not open to trivial scripted abuse
without demanding an account from someone standing next to a bleeding dog.

---

## 7. Where it runs

```
phone ──https──> Cloudflare edge ──tunnel──> cloudflared ──> Caddy 127.0.0.1:80
                                                              ├── /api/v1/*  -> hetja-api    :8080
                                                              ├── /d/*       -> hetja-scan   :8081
                                                              └── /*         -> hetja-web    :3100
                                                                              hetja-worker (no port)
                                        all of the above ──TLS──> Supabase (PostgreSQL, Mumbai)
```

The box is a small LXC container (2 vCPU, 3 GB RAM) behind NAT with **no
inbound web port**. `cloudflared` dials *out* to Cloudflare and traffic comes
back down that tunnel, so hetja.in works without a public web port, and
Cloudflare terminates TLS. Caddy listens on loopback only, runs with
`auto_https off`, and has no admin endpoint. `hetja.in` is registered at
Dynadot with its nameservers pointed at Cloudflare; `api.hetja.in` reaches the
same Caddy and is the origin the web app calls.

**Since 2026-09-24 the box is shared** with an autonomous agent that has
priority, and Hetja lives in a "room" built so it cannot hurt that agent: a
systemd slice capped at 60% of one core and 360 MB of memory, weighted to get
about a sixth of the CPU under contention, with every unit first in line for
the OOM killer; an unprivileged `hetja` user with no sudo; pinned,
checksum-verified Node, Caddy and cloudflared under `/srv/hetja/bin` (no apt,
no system Node); and a memory guard that stops the whole site below 400 MB
available and restarts it above 900 MB. The full contract, the layout and the
operating commands are in [ops/room/README.md](../ops/room/README.md).

Because every request arrives at Caddy from loopback, the room's Caddy trusts
private ranges and copies Cloudflare's `CF-Connecting-IP` into
`X-Forwarded-For` (the `real_ip` snippet in `ops/caddy/Caddyfile`), and the API
runs with `TRUST_PROXY=1`. Rate limits do not depend on it: they key on the
account or the device token, never the IP (INVARIANT 6). What it buys is
accurate request logs.

**The production database is Supabase**, in Mumbai, reached through its
session pooler with TLS required. There is no PostgreSQL on the box. This
reverses the old arrangement, in which a PostgreSQL on the (single-tenant) box
was authoritative and the Supabase project a hardened mirror that served no
reads. That box was reset, and the mirror became production. The project has
RLS on, exact coordinates unreachable from the anon key, and writes from the
anon key only through `SECURITY DEFINER` RPCs that check the slug signature.
`ops/supabase/01_schema.sql` is a hand-maintained schema file and is still
several migrations behind `packages/db/migrations` (last synchronised through
`0009`); the live project does not depend on it, because the Migrate job
applies every migration to it, but a fresh project bootstrapped from that file
alone would be wrong. Regenerate it (`pg_dump --no-privileges`, requalified per
`ops/supabase/README.md`) before using it for anything.

Uploaded photos live on the box in `/srv/hetja/photos` (`STORAGE_BACKEND=local`)
and Caddy serves them at `/photos/*` on `api.hetja.in`.

---

## 8. Getting code from a laptop into production

Push to `main`. That is the intended interface, and it is the real one.

```
git push ──> GitHub Actions
              ├── Gate ──────── typecheck · all tests (ephemeral PostGIS + pgvector)
              │                 security gate · EXPLAIN gate · 40 KB size gate
              │                 contrast gate · Caddy cache gate · systemd gate
              ├── Migrate ───── destructive-migration gate
              │                 read-only report of Supabase's state
              │                 apply new migrations to Supabase
              └── Deploy ────── build EVERYTHING on the runner, one tarball
                                scp to the box as `hetja`, hetja-deploy <id>:
                                unpack, validate, flip releases/current, stamp
                                root path unit restarts hetja-* only
                                health-check up to 180 s, roll back if not healthy
                                then check https://hetja.in through Cloudflare
```

Nothing is built on the box. The old pipeline built `api` and `worker` there
from a git checkout at `/root/hetja`, and before that it once shipped only web
and scan while restarting all four units, which went green with a stale API.
Neither can happen now: every package is built on the runner into one release,
`hetja-deploy` refuses a release that lacks any service's entry point, and the
release directory carries a `REVISION` file with the SHA it was built from.

The deploy user cannot restart anything itself. It writes a stamp file, and a
root-owned systemd path unit (`hetja-restart.path`) restarts exactly the
`hetja-*` services. `/srv/hetja` itself stays root-owned so the deploy user can
never swap the binaries root runs; the `current` symlink therefore lives in
`/srv/hetja/releases/`.

Three gates are worth naming because they say no to real things:

- **The destructive-migration gate** fails the build if a migration contains
  `DROP TABLE`, `TRUNCATE`, `DELETE FROM` and so on without an explicit
  `-- MIGRATION-APPROVED: <reason>` marker. It matches destructive *statements*,
  not the mere appearance of the words, so `ON DELETE CASCADE`, `DROP DEFAULT`
  and `GRANT … DELETE` don't trip it. A gate that cries wolf teaches people to
  paste the approval marker reflexively, and then it protects nothing.
- **`ops/security-gate.sh`** refuses code that returns raw coordinates to
  anonymous callers or adds a bare `phone`/`email` column.
- **The 40 KB budget** on `apps/scan`.

Migrations go to **one** database now, Supabase, from the Migrate job. Pushes
to `main` always migrate; a manual run (`gh workflow run deploy.yml --ref
<branch>`) migrates only with `supabase_migrate=true`.

Rollback is automatic for code and **not** for schema. If the health checks
fail, `current` flips back to the previous release and the services restart on
it. An applied migration stays applied. That is safe only because the
destructive gate keeps unattended changes additive, and additive changes are
backward compatible with the code being rolled back to.

### Working locally

You do not need to touch the box. Clone, install, work, push:

```bash
git clone git@github.com:jabezcharles420/hetja.git
cd hetja && pnpm install

pnpm --filter @hetja/ledger build      # libraries first: consumers resolve
pnpm --filter @hetja/contracts build   # them through dist/, which is gitignored
pnpm --filter @hetja/db build

pnpm -r typecheck
./ops/security-gate.sh                 # 7 checks, no database needed
./ops/check-queries.sh
pnpm --filter @hetja/scan size:gate    # the 40 KB budget

git push                               # -> gates -> migrate -> deploy
```

Run the gates before pushing. They are the same scripts CI runs, so a local
failure is a CI failure you didn't wait ten minutes to discover.

**The test suite needs a database, and that is the one thing that isn't
one-command on a laptop.** `pnpm -r test` inserts real rows, so
`apps/api/vitest.setup.ts` refuses to run against any database whose name
doesn't end in `_test`, because `medical_records` is append-only, so rows written
there by a test can never be deleted again. It needs PostgreSQL with **PostGIS,
pgvector and pgcrypto**, and a stock Homebrew PostgreSQL has only the last of
those.

Two ways to get one:

```bash
# Matches CI exactly (postgis/postgis:16-3.4 + pgvector). Needs a Docker daemon;
# on macOS with Colima that means `colima start` first.
docker run -d --name hetja-test -p 55432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=hetja_dev_2026 \
  -e POSTGRES_DB=hetja_test postgis/postgis:16-3.4
docker exec hetja-test bash -c \
  'apt-get update -qq && apt-get install -y -qq postgresql-16-pgvector'
psql "postgresql://postgres:hetja_dev_2026@127.0.0.1:55432/hetja_test" \
  -c 'CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pgcrypto;'

# Or add the extensions to an existing local PostgreSQL:
brew install postgis pgvector
```

On Windows, use WSL (Ubuntu 24.04) with the distribution's
`postgresql-16`, `postgresql-16-postgis-3` and `postgresql-16-pgvector`
packages, and run the suite from a copy of the repo inside the WSL filesystem.
The exact recipe is in [AGENTS.md](../AGENTS.md) §f.

Then apply migrations and run the suite:

```bash
export PGHOST=127.0.0.1 PGPORT=55432 PGDATABASE=hetja_test \
       PGUSER=postgres PGPASSWORD=hetja_dev_2026
pnpm --filter @hetja/db migrate
pnpm test                              # = pnpm -r --workspace-concurrency=1 test
```

The suites run one package at a time on purpose: they share one database, and
run concurrently the worker's queue tests claimed jobs the API's SOS tests were
asserting on.

One non-obvious thing if you build the database by hand: **migrations must be
applied as a superuser, so `postgres` owns the tables**, exactly as in
production. If `app_user` owns them instead, `0001_init.sql`'s
`REVOKE UPDATE, DELETE ON medical_records FROM app_user` strips the owner's own
rights, and the referential-integrity trigger behind `DELETE FROM dogs` then
fails as that owner: 48 test failures with nothing obviously wrong. This cost a
day in CI.

[AGENTS.md](../AGENTS.md) is the instruction set for handing this repository to
an agent. `ops/bootstrap.sh`, which used to bring a whole single-tenant Linux
box up, is historical now; the shared box is provisioned once with
`ops/room/bootstrap-room.sh` and never builds anything.

---

## 9. What is deliberately not finished

- The dedicated **re-tag route** (replacement collar keeps the same slug; no
  separate re-tag endpoint yet). `apps/field` as a standalone app is not
  planned; its scope is delivered as the registrator surface in `apps/web`
  (`POST /api/v1/registrations` + `POST /api/v1/dogs` for the operator path).
- `apps/shell`: the native wrapper. iOS requires add-to-home-screen before Web
  Push works at all, so until this exists, iOS responders are not reliably
  reachable. The UI says so rather than implying a safety net that isn't there.
- **The first-aid lines have no vet's sign-off yet.** They sat behind
  `FIRST_AID_ENABLED=false` for that reason until design v6, when the owner
  decided to ship the three N10 lines as designed (`apps/scan/src/firstaid.ts`,
  no flag any more). The mock itself asks for a vet's review before launch, and
  it is in [OWNER-TODO.md](OWNER-TODO.md). Bad first-aid advice given to a
  frightened stranger can kill a dog faster than doing nothing; change the
  words only with that review.
- **No languages.** English only. The language setting (N14 in v6, a Settings
  row in v5) was designed and deliberately not built, by the owner's decision,
  until human translations exist. The print sheets already draw Devanagari
  dog names.
- **Tier-2 escalation is a record, not yet a delivery.** When a case
  escalates, the worker writes `sos_notifications` rows for the three nearest
  contracted vets (channel `sms`) and the municipal desk (`bmc`), but no code
  sends an SMS or reaches the desk: Hetja has no SMS provider and no desk
  integration. Those rows are not counted as told anywhere. What actually
  reaches people today is Web Push to feeders and the numbers on the
  reporter's screen.
- **A `serious` SOS notifies only the dog's own feeders when it is filed.**
  Only a critical report ("Can't get up, or bleeding") fans out to every
  responder nearby at once; the other two choices escalate after eight
  minutes as above.
- `validate_scan` has **no producer**. Nothing enqueues it, so `ai_validation`
  stays `NULL`, `review_status` stays `pending` forever, and INVARIANT 15's
  gate can never fire from real AI output. It is recorded in
  `apps/worker/src/index.ts` `JOB_PRODUCERS` as `NONE -- see docs/INVARIANTS.md`
  rather than pretended.
- `ledger_anchors.published_url` is **`''`**, so INVARIANT 10 is not satisfied.
  The daily anchor is computed, Merkle-rooted and signed when a key is
  configured, but only ever held by us, and the invariant's whole point is a
  head published somewhere the operator does not solely control. `anchorMessage()`
  in `@hetja/ledger` exists to give a deterministic payload for that still-missing
  third-party publication.
- `STORAGE_BACKEND=s3` has **no delete path** in this build. The retention
  handler logs and returns, so photos are retained forever when that backend is
  selected. The `local` path is the only one that actually deletes.
- 93 `care_providers` are listed (25 curated + 68 imported from the maintainer's
  2026-08 verified Mumbai CSV); 43 carry phone numbers, none claimed verified
  (`phone_verified_at` stays NULL, per the honesty rule in migration 0008).
- Most `care_providers` coordinates are locality estimates, not geocoded
  points (12 exact as of the 2026-08-14 import, 81 `locality`). Every
  `phone_verified_at` is `NULL` (nobody has called these numbers), and
  every `locality` row's `distanceM` is `null` by contract rather than a
  confident 0 m. See [VET-DATA-INTAKE.md](VET-DATA-INTAKE.md); this is the gap
  the incoming government vet database is meant to close. Those counts are the
  2026-08 import. From 2026-09 the list is refreshed monthly from a CSV of
  details confirmed with each provider (`import-care.ts`, `care-import.yml`),
  which sets `phone_verified_at` to the date the row was confirmed; until the
  first monthly file is applied, the numbers above stand. Only rows with a real
  point get a pin on the map.
- The four databases on the old box were **`SQL_ASCII` / `C` collation**,
  which bites Devanagari dog or feeder names on ordering and case-folding.
  Supabase, now production, has not been re-checked here; check `\l` on the
  project before relying on non-Latin sorting. Changing collation is a
  dump-and-restore, so it is recorded rather than fixed.
- **In production the API connects to Supabase as the project's `postgres`
  user** (`PGUSER=postgres.<ref>`, written by `deploy.yml`), not as `app_user`.
  The `app_user` REVOKEs that CI and the tests reproduce therefore do not bind
  the live API, and INVARIANT 8 there rests on the `BEFORE UPDATE OR DELETE`
  trigger in `ops/supabase/03_hardening.sql`, which is not a migration. Check
  that the trigger exists on the live project rather than assuming it.
- **No backup job runs for the room.** The restic and `pg_dump` timers in
  `ops/backup` and `ops/systemd` belonged to the old box and its local database.
  Production data is in Supabase (whatever the project's plan backs up, which
  is not verified here), and uploaded photos in `/srv/hetja/photos` are not
  backed up at all.
- **The daily ledger anchor is unsigned in the room.** `deploy.yml` writes no
  `HETJA_LEDGER_SIGNING_JWK`, so anchors publish unsigned: degraded, but honest.
- **The collar page has no "lost" state.** A dog a feeder reported as not seen
  is `lost` in the database and its ward's feeders are asked to look out, but
  a stranger scanning it sees the ordinary page; the first feed or view scan
  sets it back to active.
- `DEVICE_POW_DIFFICULTY` is **16**, capped at 20. It went 14 → 18 on 2026-08-13 (enhancement stack Phase 0 #6) and 18 → 16 on 2026-08-14, which needs explaining because it reads like a retreat.

  ALTCHA encodes difficulty as a hex key prefix, and a hex digit is 4 bits, so the configured number rounds **up** to a nibble boundary. 18 therefore meant **20** effective bits, ~2^20 ≈ 1.05M expected hashes, not the ~2^18 it looks like. The `apps/scan` solver could not finish that inside its own 20-second budget: measured 4/10 solves on a dev laptop, and a ₹8,000 Android is slower. When it fails, `getDeviceToken()` returns undefined, the SOS report 401s, and the stranger standing over a hurt dog is told to phone instead: the exact degrade the module exists to prevent. 16 lands on 16 exactly and solves 25/25 in about a second.

  Two measurements are worth recording because they change how much the number matters. First, hashing was never the bottleneck: the old solver yielded with `setTimeout(0)` after every 48-hash batch, and the browser's 4 ms clamp on nested timers made the *yields* ~90% of the wall clock (0.009 ms/hash of real work versus 0.32 ms/hash with the timer tax). That is fixed independently by yielding on a 16 ms wall-clock budget via `MessageChannel`, which is ~900× cheaper per yield. Second, the PoW is not what bounds abuse at either setting. A native `createHash` loop on this box does ~696k hashes/s, i.e. 1.5 s per token at 20 bits and 0.09 s at 16. What bounds abuse is INVARIANT 7's 2/day + 5/week cap per attested device, and that cap was **not being enforced at all** until 2026-08-14: Node's base64 decoder ignores non-alphabet characters, so `tok`, `tok=`, `tok==` and `tok!` all verified as the same device while counting as three different rate-limit subjects. One solve bought unlimited SOS budget at any difficulty. Treat the PoW as a throttle; the cap is the gate.

  Device challenges are ALTCHA v2 (HMAC-signed parameters) since 2026-08-14, and single-use across restarts since migration `0021` recorded spent challenges in the database.
- The git history still contains the old working title in commit messages.
  Rewriting it invalidates every SHA, so it happens once, last.

---

## 10. The rule underneath all of it

The system is allowed to know less than it wants to. It is not allowed to
*claim* more than it knows.

That is why a distance is `null` instead of `0`, why an uncalled phone number
is labelled unconfirmed instead of shown plainly, why the scan page stopped
advertising a camera it did not have, and why the API refuses to start rather
than pretend to send an email. Every one of those was a bug where the software
looked like it was working. On a system whose failure mode is a dog dying
untreated, looking like it works is the most dangerous state available.

The fifteen [invariants](INVARIANTS.md) are the codified version of that, and
several of them are enforced by CI rather than by good intentions.
