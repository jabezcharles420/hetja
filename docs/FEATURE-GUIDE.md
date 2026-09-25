# Hetja Feature Guide

Two halves in one place: first, how to use it; second, how it works and
where the code for each piece lives. The companion to
[`docs/HOW-IT-WORKS.md`](HOW-IT-WORKS.md), which explains *why* the system is
shaped this way; this one is the complete *what* and *where*, derived from the
code rather than from memory.

---

## Part 1: Using Hetja

*No file paths, no SQL. This is for someone who has never opened the
repository. Screen numbers match the design mocks.*

### If you find a dog

You do not need an app or an account.

1. **Scan the collar.** Open your phone's own camera, point it at the square
   tag on the collar, and tap the link it offers. Or open hetja.in and tap
   **Scan**: the camera opens by itself, and a torch button appears if your
   phone has one.

2. **If the QR will not read.** After six seconds the screen offers three
   ways on. **Type the code**: the nine characters printed under the QR.
   Capitals and spaces do not matter, a 0 is read as O and a 1 or l as I, and
   if some letters are worn off you can type only the ones you can read. If
   you are one letter off, it shows you the dog it thinks you mean, with its
   photo, and asks "Is it her?". **Find by ward and photo**: pick the ward
   (or let your location pick it), narrow by coat colour, and tap the dog you
   are looking at. **Dog is hurt · Send SOS anyway**: see step 5.

3. **What you see (the dog's page).** A plain white page that loads fast on a
   cheap phone: the dog's photo (or a coloured circle with its initial), its
   name, its ward (for example `K/W ward · Andheri West`), whether it is
   vaccinated and sterilised, and the first names of the people who feed it
   (anyone can choose not to be named, and is then only counted). Each pill has
   an icon and words, so colour is never the only clue. If nobody has recorded
   a vaccination, it says "Vaccination unknown" rather than leaving a gap or
   guessing. Below that is the short story its feeders wrote and the collar
   code with **Copy**. A new dog nobody has vouched for yet says
   **Unverified**; if someone reported that the tag is on the wrong dog, the
   page says a feeder will check it, and that SOS still works. If you have
   opened the page before, it opens again without signal and says when it was
   saved. You will not see an exact location and you will not see anyone's
   phone number. Those are withheld deliberately. If the tag is broken, loose
   or on the wrong dog, **Report a tag problem** tells its feeders; you do not
   need an account.

4. **The one red button: {Name} needs help.** It works even before the page
   has finished loading. Pressing it asks what happened, with three answers:
   - **Hurt, but moving** (limping, a wound, not eating)
   - **Can't get up, or bleeding** (needs a vet now)
   - **Something else** (missing, scared, or being harmed)

   You can add a photo or a note if you like; you do not have to. Hetja asks,
   once and in words, to share where you are before your phone asks. If you
   say no, nothing is lost: you can copy the details, share your location and
   send, or send to the dog's feeders only.

5. **If Hetja does not know the dog.** A code no dog has shows "Hetja doesn't
   know this collar.", with the red button still there. So does **Send SOS
   anyway** on the scan screen. This SOS needs your location, works in Mumbai
   only, and goes to your ward: for a dog that can't get up or is bleeding,
   the people who look after dogs there are woken at once.

6. **After you send it.** You see who was told (the feeders' first names, and
   how many vets), "Waiting for a reply", and a **Call** list of vets and NGOs
   nearby whose numbers Hetja has confirmed with the provider (a place that
   is closed right now keeps its row but loses its Call button). When we do
   not have a precise address we name the neighbourhood instead of inventing
   a distance. When someone takes the case you see "Priya is on the way.",
   then when she is close and when she is there, and three things to do while
   you wait: keep traffic and people back, don't lift a dog that can't stand
   or give it food or water, and keep your hands away from its face. You can
   **send Priya an update** or tell her **I had to leave**. At the end you
   see what happened: taken to a vet, treated on the spot, not found, or that
   the dog died. The first person who says they are on the way owns the case
   and everyone else is told to stand down, so five people do not drive to
   the same animal. With no signal at all, the message is already written:
   **Open Messages** puts it in your phone's text app, and Hetja sends it by
   itself when the signal comes back. If you already sent an SOS for this dog,
   trying again shows you that case instead.

### Log a feed (screen 06, V10, V11)

*For feeders who have signed in.*

Scan the dog's collar, or tap "Feeding {Name}? Log a feed" on its page. You
can add a photo (optional), say how it went (optional): **Ate it all**, **Ate
a little**, **Didn't eat** or **Looks unwell**, and add a short note. Then
**Log feed**. The screen tells you what the feed does to your streak, and
"Rani has eaten." when it is done. On a round, open Log a feed without a dog,
tick everyone you fed ("Who did you feed?") and send them all at once. After
your first feed Hetja offers to be added to your home screen, which is what
lets an iPhone receive alerts.

- **"Looks unwell" does not raise an SOS.** It suggests one, quietly, and
  leaves the decision to you. You can tell the dog's other feeders with one
  tap. It is recorded as a flag for someone to follow up, and it never counts
  against you.
- **Offline is fine.** With no signal the feed is saved on your phone (the
  screen says how many are waiting) and replays later, exactly once.
- **Photos are cleaned.** Location and other hidden data are stripped from the
  photo before it is stored.

### Sign in (screens 07 and 08, V4 to V6)

Type your email and press **Send code**. Hetja emails you a six-digit code: no
password, no SMS. Type or paste it into the six boxes (your phone may offer to
fill it in); it checks itself as soon as all six digits are there. If nothing
arrives, you can ask for a new code after 30 seconds. Codes work for five
minutes, and only the newest one works. A wrong code says so in words ("That's
not the code. Check the newest email."). Ask for too many and Hetja tells you
the time you can try again.

The first time you sign in, **Become a feeder** asks for the name other
feeders see, the wards you feed in (up to six; you are only alerted about dogs
in them), whether you want SOS alerts, and your quiet hours. You can change
all of it later in Settings.

### Me (screen 09, V7 to V9)

Signed out, Me says what signing in unlocks, with one **Sign in** button. On
your first day it is a short checklist (sign in, scan a dog you feed, log
their first feed, pick your wards). After that:

- **Your streak** and badges, and **your trust level**: a bar showing how far
  to the next level. Trust grows with feeds (once per dog per day). The levels
  are the real thresholds: at 40 you can be paged for SOS cases, at 60 for the
  most serious ones.
- **Your dogs**, with the ones that need something first.
- Rows for **My dogs**, **Alerts** (with how many are new), the **SOS
  alerts** switch, **Register a dog** and **Settings**. Turning SOS alerts off
  offers a pause instead: until tomorrow morning, for a week, or off.
- With no signal, Me shows the last saved copy and says so.
- **Sign records as a vet** and **Bring your NGO to Hetja** (v7) start an
  application and show its status until it is decided; after that the Vet or
  NGO tab takes their place.

### Alerts and Settings

**Alerts** lists the last two weeks, newest first, grouped by day: SOS cases
near you or in your wards, tag problems, a dog confirmed or checked by a vet,
someone else feeding your dog, a dog not seen, a dog's status changing. Each
one opens the screen it is about. Alerts is reached from Me and from
notifications; it is not a tab.

**Settings** has your shown name, your wards, and **Alerts**: SOS only or
everything, the SOS switch (with the pause), and **quiet hours**, during which
nothing but an SOS comes through. **Show my first name on dogs' pages** is on
by default; turned off, you are counted as a feeder but not named. Under Your
data: **Download my data** (a file with everything Hetja holds about you),
**Sign out**, and **Delete my account**, which removes your name and sign-in
but keeps the dogs you registered and their feed logs, because other people's
care depends on them. There is no language setting yet.

### My dogs (N4, N15, N16, F6, N9)

Every dog you registered or fed in the last 60 days, with what needs doing
first (an open SOS, a tag problem, a dog missing, a vaccine due, a new dog),
and a section of new dogs other people registered that you can **confirm**
because you feed them too. Each of your dogs has:

- **Its week**: which of the last seven days it was fed and by whom, when its
  rabies booster is due, and how many vet records it has.
- **Write the story**: up to 280 characters for its page, checked before it is
  shown. Ward, never street.
- **Its tag**: open reports, **Reprint tag**, **I have a spare**, and for a
  "wrong dog" report, a way to say you checked and it is fine; plus the tag's
  history. Three reports in a week suggest a sturdier collar.
- **Update on a dog**: **Not seen** (its ward's feeders are asked to look
  out, and the next time anyone feeds it, it is back), **Adopted or in a
  shelter**, or **Passed away**, which a second feeder confirms. A dog that
  has died keeps its page, as a quiet memorial with the first names of
  everyone who fed it.

### Register a dog you look after (R1 to R8, P1 to P6, V12 to V14)

*You are the person who feeds or watches over a dog and wants it to carry a
Hetja collar. You can do it yourself, without an operator on the other end.*

1. **Start.** The first time, Register explains what it takes (a photo, a
   printed tag, about ₹150 for a collar) and switches registering on for your
   account. After that it lists your dogs, each as a sentence about what it
   needs next.

2. **New dog, in four steps.** A clear face photo (strangers use it to check
   they found the right dog). Then the dogs already on Hetja in its ward, so
   you do not give the same dog a second code: if it is there, **Same dog**
   opens its page instead. Then its name, sex and how to spot it (markings),
   and whether it is vaccinated and sterilised as far as you know. Then check
   and confirm. Only the ward is ever shown publicly, and your answers about
   vaccination and sterilisation are never shown at all: the public pills only
   change when a vet records it. You can have at most two dogs waiting for
   their collars at a time, per account and per phone; if both are taken,
   the screen says which dogs hold them before you start.

3. **The code is ready.** "{Name} is almost on Hetja." with its QR and an
   Unverified pill. **Print** offers two materials. **Paper, laminated**: ten
   small tags and a collar band, or one large tag and a wall notice, on A4 or
   Letter, as a real PDF you can download or send straight to a print shop
   from your phone; or add the dog to a **batch sheet** of up to eight dogs.
   **Laser on TPU**: the 40 mm sheet a print shop etches, with the exact
   specification to give them. Laminate a paper tag and loop it on a soft
   collar. Not too tight: two fingers under.

4. **Attach it, then scan it to switch it on.** Standing next to the dog with
   location turned on, scan the tag once from the dog's registration screen,
   which counts down the days you have left. If you scan the wrong tag, it
   tells you whose tag it is instead of switching on the wrong dog. Until the
   scan the dog is invisible everywhere: its page does not open for anyone but
   you, it is not counted on the map, and it cannot trigger an SOS. You have
   **30 days**; you get a quiet reminder on day 7 and day 21 if you allowed
   notifications, and on day 30 the registration expires. Scanning the same
   tag later brings the same dog back; a code is never given to a different
   dog. Once it is live, the same screen manages the dog: its page, reprints,
   edits, who feeds it.

5. **Why paging waits for a second scan.** One activation proves someone stood
   next to the dog once, and makes it visible. Waking real volunteers' phones
   needs one more proof: two scans from different people or phones, or one
   from a verified feeder, NGO worker or municipal officer. The page says
   **Unverified** until a vet records a checkup or a second feeder confirms
   the dog.

### If you are a vet (V1 to V5)

1. **Apply.** On Me, tap **Sign records as a vet**. Give your MSVC
   registration number, your clinic, and upload your registration certificate
   and a photo ID. Then the wards you cover, whether and when you take SOS
   calls, and the phone number you want the public to call. Your documents
   are encrypted, seen only by the Hetja team, and deleted 30 days after your
   application is decided. Me shows where your application is ("Waiting",
   "Asked for more"); if the team needs something, you see their reason and
   can send it again.
2. **The Vet tab.** Once verified, your tabs are Home, Map, Vet, Me. The Vet
   tab shows SOS cases in your wards (**I'll take it**), feeders asking you to
   sign a record, and dogs due a vaccine soon, with **Scan a collar** and a
   search by name or collar code.
3. **Sign a record.** Open a dog, choose Sign vaccination, Mark sterilised or
   Add treatment, fill it in (brand, batch, dates), and sign with your phone:
   **Sign with Face ID** on an iPhone, **Sign with your screen lock** on
   other phones. The first time, Hetja sets up a passkey on your phone; it
   never leaves the phone, and it makes every record you sign checkable. The
   record shows as **Vet signed** with your name and council number on the
   dog's page, and in a vaccination certificate anyone can download.
4. **Confirm a feeder's note.** When a feeder has noted care and asked a vet
   to sign, the form is filled in from their note; change anything that is
   wrong and sign, or tap **I didn't give this**.
5. **Correct or withdraw.** Signed records can't be edited. In My signatures,
   open one and sign a correction with a reason; the old version stays
   visible, struck through. Or withdraw it, which takes the badge off the
   dog's page and tells its feeders.
6. **Your profile**: clinic, wards, SOS hours and switch, public phone, and
   your signing passkey. If you are a government vet linked to Hetja's
   directory, you show as **Government vet · free**.

### If you run an NGO (N1 to N5)

1. **Bring your NGO to Hetja.** On Me, tap **Bring your NGO to Hetja**:
   registration type and number, the Mumbai wards you cover, what you offer
   (ambulance, shelter beds, sterilisation, collars), a contact and a public
   phone, and your registration document. The Hetja team checks it.
2. **The NGO tab.** Your tabs become Home, Map, NGO, Me. It shows cases sent
   to you (**I'll go** / **Can't**), every SOS in your wards and who is on
   it, your ambulance (in or out) and shelter beds (how many free), your
   team, drives, and the dogs in your wards.
3. **Send someone** (coordinators). On an SOS in your wards, see your people
   with how far each is from the dog (never where they are), and send one,
   with the ambulance if you like. They get the case and tap **I'm going**
   like any responder. If you can't take it, **Pass it on**: the ward's vets
   are asked at once instead of after 15 minutes.
4. **Your team.** Invite people by email as coordinator, rescue, collars or
   volunteer, note who has transport, and **vouch** for the vets who work
   with you, so their application reaches the Hetja team already vouched for.
5. **Drives.** Plan a collar, vaccination or sterilisation drive in a ward:
   date and time, lead vet, volunteers, and the dogs with what each needs. The
   day before, the feeders of those dogs are told, so they can help find
   them. On the day, tick each dog off; a vaccination only counts once a vet
   signs it.

### The Hetja team: the admin portal (A1 to A7)

*On a laptop at admin.hetja.in. On a phone it says "Admin works on a
laptop".*

- **Today**: what is waiting on you (vets to verify, avatars to review, open
  SOS cases and how long one has been unassigned, reports), each row opening
  the screen that clears it, and a search across dogs, feeders, vets and
  collar codes (⌘K).
- **Vets**: an application with its documents, a checklist item "Checked on
  the MSVC register" (with a link to the council's register), and Verify, Ask
  for more or Decline with a reason. Verified vets can be suspended (they can
  no longer sign; what they signed stays valid) or removed (their signatures
  stay, or are flagged for re-check). Invite a vet by email.
- **NGOs**: approve, edit, pause (no new SOS) or remove.
- **Avatars**: drop a folder of drawn portraits; files named with the dog's
  code or collar number match themselves, the rest you pick. Nothing goes
  live until **Publish**, and you can ask the feeder whether it looks right.
- **Dogs, merges and reports**: one dog's photos, history and status;
  **Merge** two records of the same dog (feeds, photos and signed records all
  stay, and the old link opens the kept dog); reports of duplicate dogs,
  photos, tags and fake tags.
- **Feeders**: suspend an account or block a device. **Collars**, **SOS
  cases** (assign a vet), and a read-only **Settings** page with the rules.
- **Team and roles**: Owner (everything), Moderator (vets, merges, reports,
  SOS), Avatar editor (avatars only), Ward lead (collars and SOS in their
  wards). The **audit log** records what everyone did and can't be edited by
  anyone, the Owner included; it exports as CSV.

### The map (screen 19, M1 to M7)

hetja.in/map shows all of Mumbai, and only Mumbai.

- **Mumbai right now**: dogs with collars, feeders, how many were fed today
  and how many have not been logged, and any SOS open, with the dog's name
  and whether someone is on it.
- **Each ward is one marker**, placed at the middle of the ward, showing how
  many dogs with collars live there, how many have not been fed today, and
  whether any need help right now. Dogs are shown by ward, never by street.
- **Vets and NGOs get pins**, because they are public places. Only providers
  with a real address get a pin; one we only know the neighbourhood of does
  not, so no pin is ever drawn in the wrong place. A pin next to a ward label
  is nudged aside on screen so both can be tapped.
- **Filter chips** at the top: Needs help, Not fed today, Vets, NGOs. On a
  phone the row scrolls sideways.
- **Tap a ward** to see its open cases (how serious, and how long ago; nothing
  that identifies anyone), its dogs by first name and the ones not logged
  today, and up to three vets and NGOs nearby with Call buttons. If a case
  there has nobody on it, the button is **I can go and help**; it only works
  for signed-in feeders with SOS paging on and enough trust, and it tells you
  plainly what you are missing if you are not there yet. Otherwise the button
  is **Get alerts for {ward} ward**, which makes it your home ward and turns
  SOS paging on.
- **Tap a pin** to see the place's hours ("open now" only where the hours say
  so), whether it has an ambulance on call, its phone number and a **Call**
  button.
- The vet and NGO list is Hetja's own, checked with the providers themselves
  and refreshed every month. If the street map cannot load, the map says so
  and the wards and pins still work.

### The pages around it

Home (with today's real numbers of dogs with collars and feeds logged), About,
How it works, FAQ (grouped for Feeders, Vets and Everyone), Privacy, and
Contact. `/hetja` is a memorial to the dog the project is named for: a quiet
page with no animation and no bright colour. On a computer, the reading pages
open in a phone-width column, and everything else says "Hetja lives on your
phone." with a QR code to open the same page there.

### What a responder is asked to do (P9 to P11, L4 to L6, V21, V22)

When your phone buzzes, it opens the case: the dog and its photo, the
reporter's note and photo, the ward and how far away it is, who else was told
and when it escalates, plus a single **I'm going** button, or "I can't go
right now". The first tap wins: everyone else is told to stand down (and sees
who took it), and the case is marked taken, which the stranger's screen then
shows. Only then do you see the exact spot, on a street map with Directions.
From there: **Tell the reporter you're close**, **With {Name}** when you are
there, or **I can't make it after all**, which gives the case back and alerts
the others again. When it is over, say how it ended: taken to a vet (and
which), treated on the spot, couldn't find the dog, or the dog didn't make it
(which starts the passed-away update for its feeders). Only you (the one who
took it) or a moderator can close it; the anonymous reporter cannot. If you
are not allowed to respond yet, the page shows the checklist of what is
missing instead of a bare refusal. The NGO covering the ward is told at the
same time, and if no one takes a case within 15 minutes, every verified vet
covering the ward who takes SOS calls is asked too.

**The honest caveat:** you are only reached if you allowed notifications, and
on iPhone only if you added Hetja to your home screen first. There is no SMS
fallback. Every SOS tells the dog's own feeders at once, whatever their
trust; only "Can't get up, or bleeding" also wakes every responder nearby. To
take a case you still need the trust level for it.

---

## Part 2: How it works

*For you and anyone who will work on this codebase next. Complement to
`HOW-IT-WORKS.md`: that file explains the reasoning; this one lists what
exists and where.*

### 1. The four services

| Service | App | Port (loopback) | Runs as |
|---|---|---|---|
| Web | `apps/web` (Next.js 14 App Router, standalone output) | 3100 | `hetja-web.service`, from `/srv/hetja/releases/current/web`. Also serves `admin.hetja.in` (its own Caddy block, bare host redirected to `/admin`). |
| API | `apps/api` (Fastify 5 + zod) | 8080 | `hetja-api.service`, from `.../current/api` |
| Scan | `apps/scan` (static vanilla TS, no framework) | 8081 | `hetja-scan.service`; served at `/d/*` via Caddy. 40 KB gzipped CI budget. |
| Worker | `apps/worker` (Node) | none | `hetja-worker.service`, same env file as the API. Polls Postgres with `FOR UPDATE SKIP LOCKED`. |

All four are built on the GitHub runner and shipped as one release tarball into
the shared box's capped room (`ops/room/README.md`); nothing is built on the
box. Caddy (`ops/caddy/Caddyfile`, under `ops/room/Caddyfile.global`) listens
on 127.0.0.1:80 and is fronted by a Cloudflare Tunnel; the box has no inbound
web port. The production database is **Supabase** (PostgreSQL with PostGIS,
pgvector, pgcrypto) over its session pooler. `ops/supabase/01_schema.sql` is a
hand-maintained schema file that is several migrations behind
`packages/db/migrations` (last synchronised through `0009`); the live project
gets every migration from the deploy workflow and does not depend on it, but it
must be regenerated (`pg_dump --no-privileges`, per `ops/supabase/README.md`)
before anyone bootstraps a fresh project from it.

### 2. Every screen, and where its code lives

*Derived from `apps/web/app/**` and `apps/scan/src/**` as of design v6. Board
ids are the handoff mock labels (v4 screen numbers; v5 R, F, N; v6 P, V, M,
L, D, N10 and up). Web paths are under `apps/web/` unless they start with
`apps/`.*

**Chrome.** `components/ChromeShell.tsx` decides, per route, which chrome a
screen gets and what happens on a desktop wider than 744 px
(`data-desktop`: `invite` shows `components/DesktopInvite.tsx`, D1; `frame`
centres the page at 480 px; `none` leaves it alone). The tab bar
(`components/ds/TabBar.tsx`: Home, Map, Scan, Me, or with v7's role tab
bars Vet or NGO third) shows on `/`, `/scan`, `/me`, `/vet` and `/ngo`;
`/map` draws its own inside its sheet. Every other app screen is a focused
screen with `components/ds/AppHeader.tsx`. Frame: the reading pages,
`/hetja/**`, `/sos/**` and 404s. None: `/design/**`,
`/register/<code>/print/**`, `/register/batch/**` and `/admin/**` (which also
gets no street chrome). Invite: everything else, the vet and NGO portals
included.

| Route | Screen (boards) | Code |
|---|---|---|
| `/` | Home: hero, three steps, today's real numbers, privacy band (01, 18) | `app/page.tsx`, `app/_home/impact.ts` |
| `/about`, `/how-it-works`, `/faq`, `/privacy`, `/contact` | Reading pages (12 to 16) | `app/{about,how-it-works,faq,privacy,contact}/page.tsx`, `app/faq/questions.ts`, `components/FaqList.tsx` |
| `/hetja` | The memorial (17) | `app/hetja/page.tsx` |
| `/login` | Email, then the code; "Let's take a breath." with a clock time on 429 (07, 08, V4 to V6) | `app/login/page.tsx`, `lib/login.ts` |
| `/welcome` | Become a feeder: name, wards, SOS alerts, quiet hours (N1, N13) | `app/welcome/page.tsx`, `components/FeederPrefs.tsx`, `components/AlertsAsk.tsx` |
| `/me` | Me: signed out, day one, signed in, offline copy; pause sheet (09, V7 to V9, L1, N13) | `app/me/page.tsx`, `lib/me-hub.ts`, `components/PauseAlertsSheet.tsx` |
| `/me/dogs` | My dogs, and dogs to confirm (N4, N7) | `app/me/dogs/page.tsx`, `MyDogsScreen.tsx` |
| `/me/dogs/<code>` | The dog's week (N15) | `app/me/dogs/[slug]/DogWeekScreen.tsx` |
| `/me/dogs/<code>/status` | Update on a dog: not seen, adopted, passed away (N9) | `app/me/dogs/[slug]/status/StatusScreen.tsx` |
| `/me/dogs/<code>/story` | Write the story (N16) | `app/me/dogs/[slug]/story/StoryScreen.tsx` |
| `/me/dogs/<code>/tag` | Tag reports, reprint, spare, history (F6) | `app/me/dogs/[slug]/tag/TagScreen.tsx` |
| `/alerts` | Alerts, last 14 days (N5) | `app/alerts/page.tsx` |
| `/settings` | Settings, without the Language row (N6) | `app/settings/page.tsx`, `components/FeederPrefs.tsx` (alerts, quiet hours, ward picker sheets) |
| `/scan` | Camera; after 6 s "Can't read this QR." (02, F1) | `app/scan/page.tsx`, `components/QrScanner.tsx`, `components/ScanEntry.tsx` |
| `/scan/code` | Type the code, partial code, near miss, "Tag looks fake" (V2, V3, F2, N8) | `components/scan/CodeScreen.tsx`, `FullCode.tsx`, `ScanParts.tsx`, `FakeTagSheet.tsx` |
| `/scan/find` | Find by ward and photo (F3); with `?sos=1` the SOS with no dog (F1, P8) | `components/scan/FindScreen.tsx`, `components/scan/SosAnyway.tsx` |
| `/feed` | Log a feed, a round of feeds, offline, done, add to home screen (06, V10, V11, L2, N7, V23) | `app/feed/page.tsx`, `FeedScreen.tsx`, `FeedRound.tsx`, `FeedDone.tsx`, `components/AddToHomeScreen.tsx` |
| `/register` | First dog, your registrations, signed out (V12, V13, L3) | `app/(register)/register/page.tsx`, `RegistrationsClient.tsx` |
| `/register/new` | Photo, duplicate check, about, confirm; slots full (R2 to R5, P6) | `app/(register)/register/new/RegisterFlow.tsx` and its `*Step.tsx`, `SlotsFull.tsx` |
| `/register/<code>` | Confirm the collar, wrong tag, live, manage (P1 to P4) | `app/(register)/register/[slug]/RegistrationClient.tsx` |
| `/register/<code>/ready` | The code is ready (V14, R6) | `app/(register)/register/[slug]/ready/ReadyClient.tsx` |
| `/register/<code>/print` | Material, layouts, PDF, print shop, laser sheet (R7, P5) | `app/(register)/register/[slug]/print/PrintClient.tsx`, `LaserSheet.tsx`, `lib/collar-print.ts`, `lib/collar-pdf.ts` |
| `/register/<code>/print/sheet`, `/register/batch/sheet` | HTML sheets at real millimetres, the PDF's fallback | `app/(register)/register/_sheet/PrintableSheet.tsx`, `components/CollarSheet.tsx`, `lib/collar-sheet.ts` |
| `/register/batch` | Batch sheet, up to 8 dogs (R8) | `app/(register)/register/batch/BatchClient.tsx` |
| `/sos/<caseId>` | The responder's case page, one layout per state (P9 to P11, L4 to L6, V21, V22) | `app/sos/[caseId]/SosCaseScreen.tsx`, `lib/sos-case.ts`, `components/care/SpotMap.tsx` |
| `/map` | Map, city, ward, place, taking a case, cached counts (19, M1 to M7, V20) | `app/map/page.tsx`, `app/map/api.ts`, `components/map/MapScreen.tsx`, `SheetViews.tsx`, `logic.ts`, `tiles.ts` |
| `/dog/<code>` | Redirects to the collar page | `app/dog/[slug]/page.tsx` |
| `/design` | Development style guide; 404 in production unless `HETJA_STYLEGUIDE=1` | `app/design/page.tsx` |
| 404, errors | "This lane doesn't go anywhere." (V1); error boundaries | `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx` |
| `/d/<code>` (apps/scan) | The collar page: loading, profile, no feeders yet, saved copy, Unverified, tag under review, memorial, unknown collar, outage, desktop (03, P7, V15 to V17, N9, P8, D2) | `apps/scan/index.html`, `apps/scan/src/main.ts`, `ui.ts`, `panel.ts`, `format.ts`, `api.ts` |
| `/d/<code>` report a tag problem | F4, F5 | `apps/scan/src/tag.ts` |
| `/d/<code>` SOS | What happened, location ask, no location, no signal, sent, help coming, closed, open case (04, 05, V18, N12, P12, P13, V19, N10, N11, L7) | `apps/scan/src/sos.ts`, `firstaid.ts`, `care.ts`, `format.ts` |

**The admin portal (design v7).** `/admin/**`, also served at
`admin.hetja.in` (Caddy redirects that host's `/` to `/admin`; there is no
host logic in the app). `app/admin/layout.tsx` wraps every page in
`components/admin/AdminShell.tsx`: a 232 px sidebar (Today, Vets, NGOs, Dogs,
Avatars, Feeders, Collars, SOS cases, Reports; Team & roles, Audit log,
Settings) with counts from `GET /admin/today`, the ⌘K / Ctrl K search, and
the gate states (checking, signed out, not an admin, load error). Below
1024 px a signed-in admin sees "Admin works on a laptop" instead. List screens
are list-with-detail (`?id=` selects a row; Esc, ↑ and ↓ move). Buttons and
sidebar items follow the role's permissions from `GET /admin/me`
(`components/admin/permissions.ts`); the API is the real check. Shared
pieces are in `components/admin/ui.tsx`, styles in `admin.module.css`.

| Route | Screen (boards) | Code |
|---|---|---|
| `/admin` | Today: four counts, Needs you, This week (A1) | `components/admin/TodayScreen.tsx` |
| `/admin/vets` | Vets: Waiting, Verified, Suspended, Invited; the application with the MSVC checklist, documents, verify, ask for more, decline, suspend, reinstate, remove (A2) | `components/admin/VetsScreen.tsx` |
| `/admin/vets/invite` | Invite a vet (designed here) | `components/admin/TeamScreens.tsx` `InviteVetScreen` |
| `/admin/ngos`, `/admin/ngos/new`, `/admin/ngos/edit` | NGOs: Active, Waiting, Paused; approve, pause, resume, remove; add and edit (A7, designed here) | `components/admin/NgosScreen.tsx` |
| `/admin/dogs`, `/admin/dogs/<code>` | Dogs: search; one dog's photos (take down), health, history, status, collar, avatar, feeders, merge (designed here) | `components/admin/DogScreens.tsx` |
| `/admin/merge?a=&b=` | Merge duplicate dogs (A5) | `app/admin/merge/page.tsx`, `DogScreens.tsx` `MergeScreen` |
| `/admin/avatars`, `/admin/avatars/<batch>`, `/admin/avatars/<batch>/<tile>` | Batches; drop a folder, match, publish (A3); one avatar, where it shows, ask the feeder (A4) | `components/admin/AvatarScreens.tsx`, `avatarMatch.ts` |
| `/admin/feeders`, `/admin/feeders/<id>` | Feeders: search; one feeder's feeds, dogs, trust history, suspend, block a device (designed here, D13) | `components/admin/OpsScreens.tsx` |
| `/admin/collars` | Collars: issued, reprinted, reissued, no batch number (designed here) | `OpsScreens.tsx` |
| `/admin/sos` | SOS cases: open, unassigned, escalated, closed; assign a vet, close (designed here) | `OpsScreens.tsx` |
| `/admin/reports` | Reports: duplicates, photos, tag reports, fake tags, other (designed here) | `OpsScreens.tsx` |
| `/admin/team`, `/admin/team/add` | Team and roles, recent audit, Export CSV (A6); add someone (designed here) | `components/admin/TeamScreens.tsx` |
| `/admin/audit` | The audit log, 50 at a time, Export CSV (designed here) | `TeamScreens.tsx` |
| `/admin/settings` | Read-only rules: SOS timings, who can take an SOS, budgets, keeping and deleting, limits (designed here) | `OpsScreens.tsx` |

**The vet portal (design v7).** The Vet tab root `/vet` carries the tab bar
(Home, Map, Vet, Me); every other `/vet/**` route is a focused screen.
Screens are in `components/vet/` (data `vet-api.ts`, copy `vet-copy.ts`,
passkeys `passkey.ts`). On a desktop the vet portal shows the invitation like
every app route.

| Route | Screen (boards) | Code |
|---|---|---|
| `/vet` | Vet home: SOS near you, feeders asking you to sign, due soon, scan a collar (V2) | `components/vet/VetHome.tsx` |
| `/vet/apply` | Apply with documents; waiting, asked for more, declined, suspended, removed (V1, designed here) | `components/vet/ApplyScreen.tsx` |
| `/vet/dogs/<code>` | A vet's view of a dog (V2b) | `components/vet/VetDogScreen.tsx` |
| `/vet/dogs/<code>/sign` | Sign a vaccination, sterilisation or treatment with a passkey (V3) | `components/vet/SignRecordScreen.tsx`, `passkey.ts` |
| `/vet/dogs/<code>/health` | The health list with the certificate bar (V4) | `components/vet/HealthScreen.tsx`, `HealthList.tsx` |
| `/vet/signatures`, `/vet/signatures/<id>` | My signatures; correct or withdraw one (designed here, V5) | `components/vet/VetLists.tsx`, `CorrectScreen.tsx` |
| `/vet/due` | Due soon in your wards (designed here) | `VetLists.tsx` |
| `/vet/search` | Find a dog by name or collar code (designed here) | `components/vet/SearchScreen.tsx` |
| `/vet/profile`, `/vet/passkey` | Vet profile (clinic, wards, SOS hours, public phone); set up signing (designed here) | `components/vet/VetProfileScreen.tsx` |
| `/vet/<code>/certificate` | Vaccination certificate, a PDF built in the browser (V4) | `components/vet/CertificateScreen.tsx`, `certificate-pdf.ts` |
| `/vet/<code>` | Redirects to `/vet/dogs/<code>` (was v5's N3 checkup) | `app/vet/[slug]/page.tsx` |
| `/me/dogs/<code>` (feeder) | Health list, "Note care yourself", "Ask a vet to sign", certificate | `components/vet/FeederHealth.tsx` in `DogWeekScreen.tsx` |

**The NGO portal (design v7).** The NGO tab root `/ngo` carries the tab bar
(Home, Map, NGO, Me); sub-routes are focused screens. Screens are in
`components/ngo/` (gate `NgoGate.tsx`: signed out, no NGO, not active yet, or
the portal; data `ngo-api.ts`, copy `ngo-copy.ts`).

| Route | Screen (boards) | Code |
|---|---|---|
| `/ngo` | NGO home: sent to you, SOS in your wards, ambulance and beds, team, drives, dogs (N2) | `components/ngo/NgoHomeScreen.tsx`, `UpdateSheets.tsx` |
| `/ngo/register` | Register an NGO with documents; its status (N1, designed here) | `components/ngo/NgoRegisterScreen.tsx`, `NgoStatusView.tsx` |
| `/ngo/sos/<caseId>` | Who's going: send someone, or pass it on (N3) | `components/ngo/DispatchScreen.tsx`, `TeamMap.tsx` |
| `/ngo/team`, `/ngo/team/invite` | Team, roles, vouching for vets (N4); invite (designed here) | `components/ngo/TeamScreen.tsx`, `InviteScreen.tsx` |
| `/ngo/drives`, `/ngo/drives/new`, `/ngo/drives/<id>` | Drives; plan one (designed here); run one, dog by dog (N5) | `components/ngo/DrivesScreen.tsx`, `NewDriveScreen.tsx`, `DriveScreen.tsx` |
| `/ngo/dogs` | Dogs in your wards, or the unsterilised ones (designed here) | `components/ngo/WardDogsScreen.tsx` |
| `/ngo/profile` | NGO profile (designed here) | `components/ngo/NgoProfileScreen.tsx`, `WardSheet.tsx` |

**Role tab bars and labels.** `lib/tab-role.ts` picks the tab set from
`GET /feeders/me` (`VET_TABS`, `NGO_TABS` in `components/ds/TabBar.tsx`) and
caches it under `hetja:tab-role`. `lib/care-label.ts` writes "Government vet ·
free", "Government hospital · free" and "<kind> · free" for the map, the V4
signer line, the certificate and the vet profile; the collar page has its own
copy in `apps/scan/src/format.ts` `careRow`. The collar page's health list is
`apps/scan/src/ui.ts` `healthMarkup`, filled after the profile loads.

### 3. Every API route

*Derived from `grep -rn "app.\(get\|post\|patch\)" apps/api/src/routes/` plus
`apps/api/src/server.ts` (`/healthz`, `/`). Auth column: `FEEDER` = Bearer
access token, `DEVICE` = `X-Device-Token` (ALTCHA v2 PoW / Play Integrity
attested, canonicalised via `deviceTokenSubject`), `NONE` = public, `BOTH` =
feeder or device. "What it returns" is the `data` envelope on success unless
noted as `{ok:true}` wrapper.*

| Method & Path | Auth | What it returns / side-effect |
|---|---|---|
| `GET /healthz` | NONE | `{ok:true, service:"hetja-api", time}` |
| `GET /` | NONE | `{service, docs}` |
| `POST /api/v1/auth/otp` | NONE | Issues emailed OTP (6 digits, 5 min, 3 tries, hashed). 429 if throttled. |
| `POST /api/v1/auth/verify` | NONE | Verifies OTP → `{accessToken, refreshToken, feeder}`. |
| `POST /api/v1/auth/refresh` | NONE (refresh token) | New access token. |
| `POST /api/v1/devices/challenge` | NONE | `{challenge}` (ALTCHA v2, HMAC-signed, single-use via `spent_challenges`). |
| `POST /api/v1/devices/token` | NONE + PoW solution | `{token}` (device token). Global bucket on mint. |
| `GET /api/v1/dogs/:slug` | NONE (but `?s=` signature checked when present) | Dog profile: name, ward id and `wardName`, `vaccinated` (`yes`/`unknown`), `sterilised` (`yes`/`no`/`unknown`, never `no` without evidence), `lastFedAt`, `storyAuthorCount`, `photoUrl` (never an SOS photo), story, collar status; since v5 `verified`, `tagUnderReview`, `sturdierCollarSuggested` (3 distinct reporters in 7 days) and, for a deceased dog only, `memorial.feederNames`; since v6 `feeders: {firstName}[]` (null for an opted-out feeder, at most 50), `lastFedBy`, `feederCount` (the registrator plus feeders in 60 days), `scanCount` and `sex`. First names only, never a surname or contact (`lib/public-name.ts`). `no-store`, no ETag. **404 for `pending_activation` and `expired` dogs** except to their registrator (Bearer = `dogs.registered_by`). 404 on bad slug/sig. |
| `POST /api/v1/dogs` | FEEDER + `enrol` capability | `{slug, collarUrl}`: admin enrolment. Inserts dog + collar via `lib/enrol.ts` `INSERT … ON CONFLICT (slug) DO NOTHING` loop. |
| `POST /api/v1/dogs/:slug/collar` | FEEDER + `enrol` | Re-issues collar for same slug (same `collarUrl` recomputed under current secret); writes a `collar_reissues` row. |
| `GET /api/v1/wards` | NONE | The 24 BMC wards as `{id, code, name}` (`K-West`, `K/W`, `Andheri West`). Static; Caddy caches it 60 s. |
| `GET /api/v1/wards/:wardId/dogs?colour=` | NONE (device token optional) | F3 and R3: `{wardId, total, colourTotal, dogs: DogCard[]}`, at most 30, active and lost dogs only. `DogCard = {slug, name, wardId, wardCode, photoUrl, markings, lastSeenAt, sex}`. Colour is `brown`/`black`/`white`/`spotted`. Rate limited per device or, with no token, per address, under a 3000/day global bucket (`routes/finding.ts`). |
| `GET /api/v1/dogs/lookup?code=` | NONE (device token optional) | F2 and V3: folds case, `0`→`o`, `1`/`l`→`i`, `?` (or `_`, `*`) for unknown; 400 `TOO_FEW_KNOWN` under 4 known characters. `{exact, matches, suggestions}` (at most 5 each; `suggestions` one swap or one character from a full 9-character miss). Active and lost dogs only. Same limits as ward dogs. |
| `POST /api/v1/registrations` | FEEDER (`register` cap) + DEVICE | `201 {slug, status:"pending_activation", wardId, registeredAt, expiresAt, collarUrl, budget}`. Optional `vaccinatedReported` / `sterilisedReported` (migration 0025; never read by a public route), `photoBase64` (the portrait, through the photo gate) and `markings` (at most 8). Enforces per-account (2) and per-device (2) pending budgets under `pg_advisory_xact_lock(420020)`, and 6 a week of any status (429 `REGISTRATION_WEEKLY_CAP`). |
| `GET /api/v1/registrations` | FEEDER | `{registrations:[...]}` with slug, name, status, ward and dates, plus (v6) `printedAt`, `daysLeft`, `scanCount`, `liveSince`, `lastScanAt`, `feederNames`, and the budget's `holders` (`{slug, name, printedAt, daysLeft}[]`, for P6). |
| `GET /api/v1/registrations/:slug` | FEEDER (owner or `enrol`) | `{slug,name,status,wardId,registeredAt,expiresAt,collarUrl}` plus the v6 fields above (not `holders`): signature recomputed now. |
| `POST /api/v1/registrations/:slug/tag-check` | FEEDER | P2: `{code}` → `{match, expected, scanned}`. Before activating, is the scanned tag this registration's? A wrong tag names both dogs, the scanned one only if the caller may see it (else `scanned: null`). Activation itself stays the geotagged `POST /scans`. |
| `POST /api/v1/scans` | FEEDER **or** DEVICE (one required) | `{created, scanId?}`, plus the feeder's streak on a signed-in feed. Handles EXIF-strip, photo persist, LWW `last_seen_geo` (`captured_at` primary, `received_at` tie-break), `feed` trust + streak, optional `feedOutcome` (`ate_all`/`ate_some`/`didnt_eat`/`unwell`, migration 0024, written only on create; `unwell` flags, never opens an SOS or touches `review_status`), pending activation (`status IN (pending_activation,expired) → active`), and corroboration. v6: optional `note` (280) and `tellCoFeeders: true` on an `unwell` feed (one push to the dog's other feeders, 2 then 4 a day per dog); a feed or view scan of a `lost` dog sets it `active`. `client_uuid` UNIQUE → `created:false` on replay. Rate limited per subject (burst 30, then 1 a minute; 40 photos a day). |
| `POST /api/v1/scans/batch` | FEEDER or DEVICE | V11: 1 to 12 feeds (no photos), each run through the single-scan rules; results carry `created`, `scanId` or `error` per feed. |
| `POST /api/v1/medical_records` | FEEDER + `medical` capability (vet) | Appends to hash chain under advisory lock `420001`; `{id, hash_curr}`. |
| `GET /api/v1/dogs/:slug/medical` | FEEDER | Chronological records for a dog. |
| `GET /api/v1/care?lat=&lng=&kind=&max_km=` | NONE | `{providers:[{id,name,kind,costTier,phoneE164,altPhoneE164,hasAmbulance,is24x7,hoursNote,handlesWildlife,phoneVerifiedAt,geoPrecision,locality,lat,lng,distanceM}]}`. `distanceM` only when `geo_precision='exact'` else `null`+`locality`. Up to 8, ordering `exact → distance → hasAmbulance → cost_tier → is24x7 → name`. LRU 60 s/500. |
| `POST /api/v1/reports` | FEEDER or DEVICE | Creates SOS case: `{created,caseId,tier,fanout,nearbyCare}`. Optional `note` and `photoBase64` (EXIF-stripped, saved only for a case this request opened, outside the dedupe key). Fans out to feeders with geotagged scan ≤2 km last 30d, `sos_opt_in`, `trust_score ≥ floor` (40 minor/serious, 60 critical), max 15. Inserts `sos_notifications(channel='push')` + enqueues `send_sos_push`; enqueues `escalate_sos` (now if no fan-out else +8 min). Requires `sos_eligible_at IS NOT NULL` for fan-out; `nearbyCare` is status-independent. The collar page sends `serious` or `critical` only. **Only `critical` pages feeders at report time**; the others escalate at +8 min. Since v5 feeders who chose wards are paged for any dog in them (and only those), paused feeders (v6) are not. **Dogless (v6):** without `dogSlug`, `geo` is required and must be in Mumbai (400 `GEO_REQUIRED` / `GEO_OUTSIDE_MUMBAI`); the case gets the nearest ward and keeps the point; extra limits per subject (2 then 3 a day) and per address (3 then 6 a day), and one open dogless case per reporter per ward (429 `SOS_CASE_OPEN` with `openCase`). A 429 on a dog report carries `openCase` when this device already has an open case on the dog (L7). |
| `GET /api/v1/reports/:caseId/status` | DEVICE (the filing token) or FEEDER (the filing account) | `{state, ackedAt, escalatedAt, resolvedAt}` plus (v6) `responderFirstName`, `takenAt`, `closeByAt`, `arrivedAt`, `outcome`, `vetName`, `feedersNotifiedNames` (first names, opt-outs respected), `feedersNotified`, `vetsNotified`, `updates`, `leftAt`. Never where anyone is. Uniform 404 for "not yours" and "no such case"; rate-limited per subject; `no-store`. Polled by the collar page's SOS screens. |
| `POST /api/v1/reports/:caseId/updates` | DEVICE or FEEDER (the filer) | `{note}` (1 to 280): "Send Priya an update", L7 "Add an update". 201 `{at}`; 409 once closed. |
| `POST /api/v1/reports/:caseId/left` | DEVICE or FEEDER (the filer) | "I had to leave": idempotent, `{leftAt}`. |
| `GET /api/v1/sos/cases/:id` | FEEDER (acker, paged, eligible responder, or `moderate`) | Case state `{id,severity,state,tier,openedAt,ackedAt,escalatedAt,resolvedAt,resolution,wardId,wardName,mine}`; v5 `dog`, `reporterPhotoUrl`, `note`, `respondingName`, `respondersPaged`, `nearestCare`, `declinedByMe`, and `location` (the exact point) **for the acker only**; v6 `timeline`, `feedersTold`, `vetsTold`, `ngosTold`, `escalatesAt`, `distanceM` (rounded to 100 m), `outcome`, `vetName`, `dogless`, `closeByAt`, `arrivedAt`, `reporterUpdates`, `reporterLeftAt`. Anyone else: 403 `SOS_CASE_FORBIDDEN` with `forbiddenReason` and the V22 checklist. |
| `POST /api/v1/sos/cases/:id/decline` | FEEDER (paged) | "I can't go right now": marks this page declined. Never touches escalation. |
| `POST /api/v1/sos/cases/:id/release` | FEEDER (acker) | "I can't make it after all": back to open, re-pages everyone paged except the releaser and decliners, escalation clock unchanged. |
| `POST /api/v1/sos/cases/:id/arrived` | FEEDER (acker) | "With Rani" (V21). |
| `POST /api/v1/sos/cases/:id/close-by` | FEEDER (acker) | "Tell the reporter you're close". |
| `POST /api/v1/sos/cases/:id/ack` | FEEDER (paged, eligible responder, or `moderate`) | Conditional `UPDATE … WHERE acked_by IS NULL AND resolved_at IS NULL`: first writer wins, 409 otherwise; stand-down of losers. 403 `SOS_ACK_FORBIDDEN` for anyone else, 409 `SOS_TOO_MANY_OPEN_ACKS` past two open. |
| `POST /api/v1/sos/cases/:id/resolve` | FEEDER (acker or `moderate`) | `{id,state,resolvedAt,resolution}`; idempotent retry if already resolved. v6 `outcome`: `taken_to_vet` (with `vetName`), `treated_on_spot`, `not_found`, `died` (files a pending passed-away status report); `resolved` / `false_alarm` still work. |
| `GET /api/v1/heatmap?ward=` | NONE | Aggregated counts per 500 m cell/ward for heatmap. |
| `GET /api/v1/map/wards` | NONE | Every BMC ward: `{id, code, name, lat, lng, dogs, notFedToday, sosOpen, latestSos}`; `lat`/`lng` is the fixed ward centre from `BMC_WARD_CENTROIDS`, never a dog. v6 `summary` (`dogs`, `withCollars`, `feeders`, `fedToday`, `notLoggedToday`) and `sos[]` rows with `dogName` and `taken`. 60 s cache. |
| `GET /api/v1/map/wards/:wardId` | NONE, or FEEDER for case ids | One ward's counts, open cases (`severity, raisedAt, state, feedersTold, mine`; `caseId` only for a signed-in caller who meets the fan-out's responder rules or holds the case) and up to 3 nearby providers; v6 `dogNames` and `notLoggedToday[{name, lastLoggedAt}]` (at most 30). Ward level only. Anonymous answer cached in process; Caddy sends `no-store` for every ward detail. |
| `GET /api/v1/map/places?bbox=&kind=` | NONE | Listed vets/NGOs with an **exact** point in the box (max 2.5° a side, up to 200, `truncated` flag). Locality-precision rows never get a pin. 60 s cache. |
| `GET /api/v1/stats/impact` | NONE | The home page's real counts (dogs with collars, feeds logged). 60 s cache. |
| `GET /api/v1/ledger/anchor` | NONE | Latest `ledger_anchors` row `{head_hash, merkle_root, record_count, published_at, signed}`. |
| `GET /api/v1/ledger/verify` | NONE | Recomputes the chain over exactly the latest anchor's `record_count` prefix and compares; reports growth as `newerRecords`. |
| `GET /api/v1/ledger/proof?hash=` | NONE | Merkle inclusion proof for a record hash. |
| `POST /api/v1/trust/disputes` | FEEDER | Opens dispute `{dispute_state:'open'}`, no delta reversal yet. |
| `POST /api/v1/trust/disputes/:id/resolve` | FEEDER + `moderate` | Resolves dispute: reverses exactly the disputed delta (`reversal`), recomputes score. |
| `GET /api/v1/feeders/:id/trust` | FEEDER (own id only, 403 otherwise) | The caller's own trust. A pure read since 2026-09-07: it writes nothing. |
| `POST /api/v1/feeders/:id/trust/evaluate` | FEEDER | The explicit write path for the INVARIANT 15 verification gate. |
| `GET /api/v1/territories/:feederId` | FEEDER | Territory for a feeder. |
| `POST /api/v1/territories` | FEEDER | Create/update territory. |
| `POST /api/v1/territories/claim` | FEEDER | Claim territory. |
| `GET /api/v1/feeders/me` | FEEDER | Own profile, including `homeWard`, `sosOptIn`, `trustScore`, `registrationBudget`; v5 `wards`, `quietHours` (`{start,end}` "HH:MM" or null), `alertsMode` (`sos_only`/`all`), `onboarded`, `publicName`; v6 `showFirstName`, `sosPausedUntil`. |
| `PATCH /api/v1/feeders/me` | FEEDER | Strict, at least one of `sosOptIn`, `displayName` (1 to 40), `homeWard`, `wards` (0 to 6 BMC ids), `quietHours` (or null), `alertsMode`, `onboarded: true`, `showFirstName`, `sosPausedUntil` (future, at most 30 days, or null). 400 `INVALID_FEEDER_PATCH` (`INVALID_SOS_OPT_IN` for a bad `sosOptIn`). |
| `GET /api/v1/feeders/me/export` | FEEDER | The caller's own data as a JSON download. 3 then 5 a day. |
| `DELETE /api/v1/feeders/me` | FEEDER | `{confirm: "DELETE"}`: anonymise ("Former feeder", identity HMAC replaced, wards, quiet hours, sessions, push subscriptions and OTPs removed, acked cases released). Dogs and feed logs stay. `{deleted: true}`. |
| `GET /api/v1/feeders/me/alerts` | FEEDER | N5: `{items: Alert[]}`, last 14 days, at most 50, newest first; kinds `sos`, `tag`, `verified`, `fed`, `not_seen`, `status`, each with an `href`. |
| `GET /api/v1/feeders/me/dogs` | FEEDER | N4: every dog the caller registered or fed in 60 days, with `photoUrl`, `status`, `verified`, `registeredByMe`, `lastFedByName`, nullable `myLastFedAt`, `wardName`, `sex`, and one `attention` (`sos` > `tag` > `missing` > `vet` > `new`). |
| `POST /api/v1/feeders/me/surface` | FEEDER | Self-elect registrator / surfaces. |
| `GET /api/v1/feeders/me/streak` | FEEDER | `{streakDays, lastFeedDate, badges, trustScore, streakStart, trustLevel}`. |
| `POST /api/v1/feeders/me/badges/check` | FEEDER | Badge evaluation. |
| `POST /api/v1/dogs/:slug/stories` | FEEDER | Add story (unique per feeder+dog). |
| `GET /api/v1/dogs/:slug/stories` | NONE | Stories for a dog. |
| `POST /api/v1/dogs/:slug/confirm` | FEEDER (a feeder of the dog, not its registrator or registering device) | Second-feeder verification: `{verified: true, via: "feeder"}`. |
| `POST /api/v1/dogs/:slug/checkups` | FEEDER (`vet` role and a `vets` registry row) | v5 N3, no longer called by the web app (v7 signing replaced it): `{rabies, sterilised, nextVaccineDue?, noteForFeeders?, examined: true}` → medical records through the one chain writer; verifies the dog. 201 `{verified: true, via: "vet"}`. |
| `POST /api/v1/dogs/:slug/status-reports` | FEEDER (of the dog) | N9: `{kind}` = `not_seen` (dog `lost`, ward's feeders asked to look out), `adopted`, or `passed_away` (waits for a second feeder, 30 days). 201 `{id, status, needsConfirmation}`. |
| `GET /api/v1/dogs/:slug/status-reports` | FEEDER (of the dog) | The pending passed-away reports. |
| `POST /api/v1/dogs/:slug/status-reports/:id/confirm` | FEEDER (of the dog, not the reporter) | Sets `deceased`. |
| `GET /api/v1/dogs/:slug/week` | FEEDER (of the dog) | N15: the last 7 Mumbai days `{date, fed, outcome, byFirstName}[]`, `feederNames`, `rabiesDue`, `vetRecordCount`. |
| `POST /api/v1/dogs/:slug/tag-reports` | DEVICE or FEEDER | F4: `{kind}` = `damaged`, `found_on_ground`, `wrong_dog` (puts the tag under review), `too_tight`. 201 `{reportId, feedersNotified, wardCode}`; 200 for a repeat within 24 h. Limited per device, per dog and per address. Pushes the dog's feeders. |
| `GET /api/v1/dogs/:slug/tags` | FEEDER (of the dog) | F6: `{open, history, reportsThisWeek, sturdierCollarSuggested}`. |
| `POST /api/v1/dogs/:slug/tag-reports/:id/resolve` | FEEDER (of the dog) | `{resolution}` = `reprinted`, `spare`, `checked_ok`; the review clears once no wrong-dog report is open. |
| `POST /api/v1/dogs/:slug/prints` | FEEDER | `{layout, paper, tagCount}`: records a print for the tag history. 201 `{id}`. |
| `GET /api/v1/dogs/:slug/collar` | FEEDER (registrator or feeder of the dog) | `{slug, name, wardId, collarUrl}` for the print screen. |
| `POST /api/v1/collars/batch` | FEEDER | R8: `{slugs}` (1 to 8) → `{dogs, skipped}`. |
| `POST /api/v1/metrics/web-vitals` | NONE | Ingest Web Vitals. |
| `GET /api/v1/metrics/web-vitals` | FEEDER + `moderate` | Aggregated vitals. |
| `GET /api/v1/moderation/queue` | FEEDER + `moderate` | Review queue (`pending` scans). |
| `POST /api/v1/moderation/:id/approve` | FEEDER + `moderate` | Approves scan; trust `photo_accepted +10` or `verified_scan +10`. |
| `POST /api/v1/moderation/:id/reject` | FEEDER + `moderate` | Rejects scan; `photo_rejected -5` etc., may auto-pause. |
| `GET /api/v1/push/vapid-public-key` | NONE | VAPID public key. |
| `POST /api/v1/push/subscribe` | FEEDER | Stores `{endpoint, p256dh, auth}`. |
| `POST /api/v1/push/unsubscribe` | FEEDER | Removes subscription. |

**Design v7 routes.** Admin routes are in `routes/admin.ts` (vets, NGOs,
documents, team, audit, settings) and `routes/admin-content.ts` (avatars,
dogs, merges, feeders, collars, SOS, reports). Every one calls `requireAdmin`
(`lib/admin.ts`: live roles, never a JWT claim) and names a permission from
`ROLE_PERMISSIONS`; writes are rate limited per account and audited
(`lib/audit.ts`). `(Owner)` marks the permissions only the Owner holds.

| Method & Path | Auth | What it returns / side-effect |
|---|---|---|
| `GET /api/v1/admin/me`, `/admin/today`, `/admin/search?q=` | any admin role | Roles, permissions and wards; A1's cards, sidebar counts, "needs you" and week (filtered by permission); search over dogs, feeders, vets, collars, NGOs. |
| `GET /api/v1/admin/vets`, `/admin/vets/:id` | `vets` | The list with counts; one application with its documents. |
| `POST /api/v1/admin/vets/:id/verify` \| `ask-more` \| `decline` \| `suspend` \| `reinstate` \| `not-on-register` | `vets` | A2 decisions (`verify` needs `registerChecked: true`, optional `validTo`; the others a reason). A decision starts the documents' 30-day clock. |
| `POST /api/v1/admin/vets/:id/remove` | `vets_remove` (Owner) | `{reason, signatures: "keep" \| "flag"}`; unlinks the vet from NGOs. |
| `POST /api/v1/admin/vets/invite` | `vets` | Invite by email (only the identity HMAC is kept). |
| `POST /api/v1/admin/vets/:id/link-care`, `/admin/ngos/:id/link-care`; `GET /admin/care?q=` | `vets` / `ngos` | Link an account to its care-directory row (what makes a vet a government vet). |
| `GET /api/v1/admin/documents/:id` | `vets` or `ngos`, by owner | Streams the decrypted document; audited as `document.view`. |
| `GET/POST /api/v1/admin/ngos`, `GET/PATCH /admin/ngos/:id`, `POST .../approve` \| `pause` \| `resume` | `ngos` | A7: list, create (active, optional coordinator invite), edit, decide. |
| `POST /api/v1/admin/ngos/:id/remove` | `ngos_remove` (Owner) | Unlinks its vets and ends every membership. |
| `GET /api/v1/admin/team`; `POST /admin/team`, `/admin/team/:feederId/role`, `.../remove` | `team_read`; `team` (Owner) | A6 team; grant or invite, change a role, remove. The config Owner cannot be removed here. |
| `GET /api/v1/admin/audit`, `/admin/audit.csv` | `audit` | The log, paged; CSV (formulas neutralised, the export itself audited). |
| `GET /api/v1/admin/settings` | `settings` | The rules, read-only. |
| `GET/POST /api/v1/admin/avatars/batches`, `GET .../batches/:id`, `POST .../batches/:id/files` \| `publish` | `avatars` | A3: batches; upload (matched by file name); publish the batch. |
| `GET /api/v1/admin/avatars/:id`; `POST .../match` \| `publish` \| `restore` \| `ask-feeder` \| `file` | `avatars` | A4: one avatar; restore within 30 days. |
| `GET /api/v1/admin/dogs`, `/admin/dogs/:slug`; `POST /admin/dogs/:slug/status` | `dogs` (ward lead: own wards); `merge` | Dogs; set a status with a reason. |
| `GET /api/v1/admin/duplicates`; `POST /admin/dogs/merge`, `/admin/duplicates/dismiss` | `merge` | A5. |
| `POST /api/v1/admin/photos/:scanId/hide` | `reports` | Take a photo down from every API response. |
| `GET /api/v1/admin/feeders`, `/admin/feeders/:id`; `POST .../suspend` \| `unsuspend`; `POST /admin/devices/block` \| `unblock` | `feeders` | D13 tools; suspending releases the cases the account holds. |
| `GET /api/v1/admin/collars`, `GET/PATCH /admin/collars/:slug` | `collars` (ward lead: own wards) | PATCH sets `batch_no`. |
| `GET /api/v1/admin/sos`, `/admin/sos/:id`, `/admin/sos/:id/vets`; `POST .../assign-vet` \| `resolve` | `sos` (ward lead: own wards) | Cases; assign a vet (until someone has taken the case); close. |
| `GET /api/v1/admin/reports`; `POST /admin/reports/:id/resolve`, `/admin/tag-reports/:id/resolve` | `reports` | Problem and tag reports. |
| `GET /api/v1/vet/me`; `PATCH /vet/me` | FEEDER | The caller's vet profile, passkeys, documents, `canSign`, `canAcceptSos` (claims any invite); edit clinic, wards, SOS hours, public phone. |
| `POST /api/v1/vet/apply` | FEEDER | V1: needs a `certificate` and a `photo_id` document. |
| `GET /api/v1/vet/home`, `/vet/due-soon`, `/vet/dogs?q=`, `/vet/dogs/:slug`, `/vet/sign-requests`, `/vet/sign-requests/:id`, `/vet/signatures`, `/vet/signatures/:id` | verified (or suspended) vet | V2, V2b and the lists. |
| `POST /api/v1/vet/sign-requests/:id/decline` | vet | "I didn't give this". |
| `POST /api/v1/vet/passkeys/options`, `/vet/passkeys`, `/vet/passkeys/:id/remove` | verified vet (remove: FEEDER) | Register a passkey (at most 5), or remove one. |
| `POST /api/v1/vet/records/options`, `/vet/records` | verified vet | V3/V5: the record hash as the WebAuthn challenge, then the assertion; appends a vet-signed record, a correction (`supersedes` + reason) or a `withdrawal`. |
| `POST /api/v1/vet/record-photos` | verified vet | An encrypted vaccine-sticker photo for a record. |
| `POST /api/v1/ngo/register`; `GET/PATCH /ngo/me` | FEEDER; coordinator | N1: needs an `ngo_registration` document, makes the caller coordinator; the NGO and its status; edit. |
| `GET /api/v1/ngo/home`; `POST /ngo/ambulance`, `/ngo/beds` | member; coordinator or rescue | N2; ambulance in or out, beds free. |
| `GET /api/v1/ngo/sos/:caseId/candidates`; `POST .../dispatch`, `.../pass` | coordinator | N3: members with distance rounded to 100 m; send one (optionally the ambulance); pass to the vets now. |
| `GET /api/v1/ngo/dispatches/mine`; `POST /ngo/dispatches/:id/accept` \| `decline` | the member sent | Cases sent to me. |
| `GET /api/v1/ngo/team`; `POST /ngo/team/invite`; `PATCH /ngo/team/:feederId`; `POST .../remove`; `POST /ngo/vets/:feederId/vouch` | member; coordinator | N4. |
| `GET /api/v1/ngo/dogs?filter=` | member | Dogs in the NGO's wards. |
| `GET/POST /api/v1/ngo/drives`, `GET/PATCH /ngo/drives/:id`, `POST .../dogs`, `PATCH .../dogs/:driveDogId`, `POST .../start` \| `finish` | member; coordinator (dogs: collars or rescue too) | N5 drives. |
| `GET /api/v1/dogs/:slug/health` | NONE | V4: the health list (`vet_signed` / `feeder_noted`, corrections, withdrawals, flags) and `certificateUrl`; a merged dog's records read with the kept dog's. Rate limited per device or address. |
| `GET /api/v1/dogs/:slug/health/:recordId/photo` | verified vet, feeder of the dog, or admin | A record's private sticker photo. |
| `GET /api/v1/wards/:wardId/professionals`, `/dogs/:slug/vets` | NONE | Verified vets and active NGOs with their public numbers (`isGovernment` where linked). |
| `POST /api/v1/dogs/:slug/problems` | FEEDER or DEVICE | Report a duplicate dog, a photo or something else (limited per device, dog and address). |
| `POST /api/v1/dogs/:slug/health-notes`, `/dogs/:slug/sign-requests` | FEEDER (of the dog) | "Feeder noted" care; "Ask a vet to sign" (to one vet or up to 10 covering the ward; optional clinic-slip photo). |
| `GET/POST /api/v1/dogs/:slug/avatar-signoff` | the feeder asked | A4's feeder sign-off: looks right, or redo. |
| `POST /api/v1/documents` | FEEDER (checked before the body is read) | Upload an encrypted document (PDF up to 5 MiB, images up to 2 MiB); 503 without `HETJA_DOCS_KEY`. |

Care lookups (`GET /care`, the SOS answer's `nearbyCare`, the map) now carry
`isGovernment`, `isPerson`, `regNo`, `publicPhone` and `wards`, and a
government row's `costTier` is always `free`. The SOS answer also carries
`professionals`, and the map's ward detail the ward's vets and NGOs.

### 4. Data model

*Forty-six domain tables plus `schema_migrations`. `0001_init.sql` creates
the core fifteen; `care_providers` (0008), `otp_codes` (0010),
`push_subscriptions` (0011), `web_vitals` (0013), `refresh_tokens` (0017),
`spent_challenges` (0021), `collar_reissues` (0023), `tag_reports`,
`tag_prints` and `dog_status_reports` (0026, design v5) and `sos_case_events`
(0027, design v6) and the twenty of `0029` (design v7, below) arrive later;
`0024`, `0025` and `0028` add columns only. `\dt` counts higher because PostGIS ships
`spatial_ref_sys`. The count query is in `docs/HOW-IT-WORKS.md` §5.*

**Grouped by domain:**

- **Register:** `dogs` (slug UNIQUE, 40 random bits + check char;
  `vaccinated_reported` / `sterilised_reported` from 0025, the registrator's
  self-report, never read by a public route; from 0026 `markings` (at most
  8), `verified_at` / `verified_by` / `verified_via` (`vet` or `feeder`),
  `tag_review_since` and `vaccine_due_month`), `collars`
  (`qr_code`, `hmac_sig`, `batch_no`, `material`, `bound_once`, `retired_at`,
  `status`).
- **Observations:** `scans` (`dog_id`, `client_uuid` UNIQUE, `scan_type`,
  `geo GEOGRAPHY(Point,4326)`, `feeder_id`, `device_token`, `captured_at`,
  `received_at`, `review_status`, `ai_validation`, `photo_s3_key`,
  `last_seen_received_at`, `feed_outcome` from 0024:
  `ate_all`/`ate_some`/`didnt_eat`/`unwell` or NULL, and `note` from 0027;
  `dog_id` became nullable in 0027 for a dogless SOS scan, with a check that
  only an SOS scan may lack a dog).
- **Accounts:** `feeders` (`identity_hmac` UNIQUE, HMAC-SHA256 under
  `HETJA_HMAC_PEPPER`, never bare; `display_name`, `role`, `trust_score` 0-100
  derived from `trust_events`, `verification_tier`, `sos_opt_in`,
  `can_register` kill switch, `streak_days`, `badges`, `last_known_geo`,
  `home_ward`, set from the map's "Get alerts" button; from 0026 `wards`
  (at most 6), `quiet_start` / `quiet_end` (minutes after midnight, Mumbai),
  `alerts_mode`, `onboarded_at`, `deleted_at`; from 0027 `show_first_name`
  (default true) and `sos_paused_until`).
- **Medical ledger:** `medical_records` (append-only, hash-chained) +
  `ledger_anchors` (`head_hash`, `merkle_root`, `record_count`, `ledger_id`,
  `published_at`, `head_signature`, `published_url`, still `''`).
- **SOS:** `sos_cases` (`severity`, `state` open/acked/escalated/resolved/false_alarm,
  `tier`, `opened_at`, `acked_at/by`, `escalated_at`, `resolved_at`,
  `resolution`; `note` from 0026; from 0027 a nullable `dog_id`, `ward_id`,
  `geo` (a dogless case's point, acker only), `outcome`, `vet_name`,
  `close_by_at`, `arrived_at`, `reporter_left_at`, with a check that a case
  has a dog, or a ward and a point), `sos_notifications` (`case_id`, `feeder_id`/`vet_id`,
  `channel` push/sms/bmc, `delivered_at`, `acked_at`, `stood_down`,
  `declined_at` from 0026), `sos_case_events` (0027: `released`, `close_by`,
  `arrived`, `reporter_update`, `reporter_left`, with an optional 280-character
  note).
- **Design v7 (0029):** `admin_roles` (owner, moderator, avatar_editor,
  ward_lead; wards for a ward lead; revoked, never deleted), `audit_log`
  (append-only by REVOKE and triggers, no foreign keys), `invites` (vet, team,
  NGO member; identity HMAC only), `vet_profiles` (council MSVC, reg no,
  clinic, wards, SOS availability and hours, public `phone_e164`, status,
  register check, decision, NGO vouching, care-directory link, signatures
  flagged), `documents` (metadata only; the AES-256-GCM bytes are under
  `DOCS_LOCAL_DIR`; `delete_after`, `deleted_at`), `webauthn_credentials` and
  `webauthn_challenges`, `ngos` (registration, 80G, wards or citywide,
  offers, public phone, ambulance and beds state, status), `ngo_members`,
  `ngo_vets`, `sos_dispatches`, `sign_requests`, `drives` and `drive_dogs`,
  `avatar_batches` and `dog_avatars`, `dog_merges` and
  `duplicate_dismissals`, `reports`, `blocked_devices` (a hash of the device
  id). New columns: `medical_records.record_source` (`vet_signed` or
  `feeder_noted`), `signed_by`, `credential_id`, `assertion`, `record_hash`,
  `correction_reason`, `drive_dog_id`, `noted_by` (a correction or withdrawal
  still points back through the original `corrects_record_id`);
  `sos_cases.ngo_id`, `ngo_routed_at`, `ngo_passed_at`, `vets_opened_at`;
  `sos_notifications.route` (`ngo_coordinator`, `ngo_dispatch`,
  `vet_escalation`, `admin_assign`); `dogs.merged_into` / `merged_at` and a
  `merged` status; `scans.merged_from_dog_id`, `photo_hidden_at/by`;
  `feeders.suspended_at/reason/by`; `tag_reports.admin_outcome`;
  `care_providers.is_government`, `is_person`, `reg_no`, `wards`. And from
  0028, `sos_notifications.notify_only` (the dog's own feeder below the trust
  floor: told, never a ground to take the case).
- **Tags and status (0026):** `tag_reports` (`kind`, reporter feeder or a
  SHA-256 of the device, `resolved_at/by`, `resolution`), `tag_prints`
  (`layout` tags/notice/batch, `paper` a4/letter, `tag_count`),
  `dog_status_reports` (`kind` not_seen/adopted/passed_away, `reported_by`,
  `confirmed_by/at`).
- **Care directory:** `care_providers` (`name`, `kind` ngo/govt/charity_hospital/
  private_clinic, `cost_tier`, `phone_e164`, `alt_phone_e164`, `geo`,
  `geo_precision` exact/locality, `locality`, `has_ambulance`, `is_24x7`,
  `ward_id`, `phone_verified_at`, always NULL so far).
- **Contracted partners:** `vets` (`feeder_id`, `geo`, `signing_key_pub NOT NULL`,
  `mou_signed_at`, `retainer_paise`).
- **Territory / geofence:** `geofences`, `feeder_territories`,
  `dog_stories` (unique per dog+feeder), `trust_events` (appended via
  `logTrustEvent`, score via `recomputeScore` from `TRUST_BASELINE`).
- **Ephemeral:** `otp_codes` (hashed, 5 min, 3 tries), `push_subscriptions`,
  `web_vitals`, `jobs` (`kind`, `payload JSONB`, `run_after`, `locked_until`,
  `attempts`, `failed_at`/`last_error` (park, never delete), added 0016),
  `refresh_tokens`.

**Append-only `medical_records`:** enforced by `REVOKE UPDATE,DELETE` (and
`TRUNCATE` + `BEFORE TRUNCATE` trigger) from `app_user` (self-hosted), and by
`BEFORE UPDATE OR DELETE` trigger for every role including owner on Supabase.
Each row stores `payload_len`, `hash_prev`, `hash_curr`, `payload`,
`hash_vet_id`, `hash_ts`; hashes are length-prefixed (INVARIANT 9).

**Ledger hash chain:** `@hetja/ledger` `hashInput` /
`computeHash` length-prefixed, RFC 6962 Merkle root persisted per append
(0014) and served as inclusion proofs.

### 5. The `dogs.status` state machine

```
pending_activation ──(geotagged scan by any feeder or attested device)──▶ active
       │                                                                   │
       ├─(≥30d without activation, worker sweep)──▶ expired ──(geotagged scan)──▶ active
       │                                                                     │
       └─────────────────────────────────────────────────────────────────────┘

active ──(N9 "Not seen", a feeder of the dog)───────────────────────────▶ lost
lost ──(any feed or view scan)─────────────────────────────────────────▶ active
active | lost ──(N9 "Adopted")───────────────────────────────────────────▶ adopted
active | lost ──(N9 "Passed away" + a second feeder confirms, 30 d)──────▶ deceased
active ────────────────────────────────────────────────────────────────▶ relocated
any ──(A5 admin merge into the kept dog, v7)────────────────────────────▶ merged
(deceased / adopted / relocated / merged are terminal; lost is not. A merged
dog's slug serves the kept dog's page (`dogs.merged_into`). The happy-path
is pending → active and staying active. Since v5 feeders drive lost, adopted
and deceased from Update on a dog (`routes/dog-status.ts`); an SOS closed as
`died` files the first passed-away report. The finding reads
(`/dogs/lookup`, `/wards/:id/dogs`) show active and lost dogs. Heatmap and ward index carry
`WHERE status='active'` so pending and expired rows are invisible to public reads,
and so do the map's counts. `GET /dogs/:slug` answers 404 for them (except to
their registrator) since 2026-09-24; before that it had no status filter.
`expired` is not reuse: the slug never moves to a different dog; re-activating
the same row is the documented recovery.)
```

Columns that annotate the machine: `dogs.registered_by` (FK → `feeders`, `ON
DELETE SET NULL` so a DPDP erasure can delete the feeder without deleting the
dog), `registered_at` (clock for the 30-day window), `activated_at` +
`activation_scan_id` (provenance, not a FK), `sos_eligible_at` (set once, never
cleared; see “why materialised” in `scans.ts`), `registered_device_id`
(canonical device subject, per-device budget), `activation_reminders_sent`
(0→1 day 7, 1→2 day 21).

### 6. Worker jobs

*Postgres-backed queue, `SELECT … FOR UPDATE SKIP LOCKED`, three transactions
per job (claim → run → settle) so attempt counts survive handler rollback.
`MAX_ATTEMPTS=8`, backoff 5 s × 2^(n-1) capped at 1 h; exhausted rows set
`failed_at` and are never claimed again (park, not delete). Advisory
`pg_try_advisory_xact_lock` (try, not wait) prevents double-enqueue.*

| Kind | Producer (see `JOB_PRODUCERS` in `apps/worker/src/index.ts`) | Schedule / enqueue | What it does | Retry |
|---|---|---|---|---|
| `validate_scan` | **NONE**; see `docs/INVARIANTS.md` | (none: never enqueued; `ai_validation` stays NULL, `review_status` stays `pending`) | Stub would call AI worker | Would retry like any job, but is never queued |
| `escalate_sos` | `apps/api/src/routes/sos.ts` (`POST /api/v1/reports`, immediate or +8 min; `/release` and account deletion re-queue it at `GREATEST(now(), opened_at + 8 min)`) | Per SOS case | If case still open/unacked (`state='open' AND acked_by IS NULL FOR UPDATE`), promotes to tier 2 and writes `sos_notifications` rows for the 3 nearest contracted vets (to the dog's last position, or a dogless case's own point) and the BMC desk. Those rows are records: nothing sends the `sms` or `bmc` channel yet | Park on 8 |
| `send_sos_push` | `apps/api/src/routes/sos.ts` (`dispatchFanout`; `/release` re-pages with `repage: true`) | Per fanned-out SOS case (only when eligible), and again on release | VAPID-signed push via `sendPush` → `sendOnePush` wrapper that writes `sos_notifications.delivered_at`; 404/410 deletes the dead `push_subscriptions` row | Park; `PUSH_ENABLED` false → degrade (return, do not crash, `delivered_at` stays null, an honest “not reached”) |
| `retention` | `apps/worker` `enqueueRetentionJobIfDue` (advisory 420011, 24 h `run_after` guard, 5-min throttle) | Daily | Deletes raw photos older than `HETJA_PHOTO_TTL_DAYS` (7) from local directory, validates key `^photos/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$`, `unlink` then `photo_s3_key=NULL`; `s3` backend logs and does nothing | Park |
| `anchor_ledger` | `apps/worker` `enqueueAnchorJobIfDue` (420010, “no anchor in 24 h” from `ledger_anchors`) | Daily | `publishLedgerAnchor`: ordered scan of `medical_records` (`created_at ASC, id ASC`), head = last stored `hash_curr` (not recomputed), Merkle root via `@hetja/ledger`, optional EdDSA signature (`sign-anchor.ts`), inserts `ledger_anchors` with `published_url=''` | Park |
| `expire_stale_registrations` | `apps/worker` `enqueueRegistrationSweepIfDue` (420012, mirror of retention: `failed_at IS NULL AND run_after > now()-24h`) | Daily | One `withTx`, three passes in order: day 7 (`activation_reminders_sent 0→1`), day 21 (`1→2`), expire (`status='pending_activation' AND registered_at≤now()-30d → status='expired', registered_device_id=NULL`, retire collars `retired_at=now(), status='retired'`). Each reminder pass carries `activation_reminders_sent=N-1` so double-run reminds once; reminders handed off as `send_registration_reminder` jobs | Park; `failed_at IS NULL` filter is load-bearing; without it one dead-letter stops expiry forever |
| `send_registration_reminder` | `expire_stale_registrations` handler | Per pending dog on day 7 / 21 | Push to `dogs.registered_by`’s subscribers via `sendPush` (no `sos_notifications` row); payload `tag=registration-<dogId>-<reminder>` and print-page URL; `PUSH_ENABLED` false → degrade | Park |
| `sos_open_to_vets` | `packages/db/src/sos-routing.ts` `scheduleOpenToVets` (from `POST /api/v1/reports`, 15 minutes out; at once when the NGO passes or nobody could be told) | Per SOS case | v7: if nobody has taken the case, pages every verified vet whose wards include the case's ward and who takes SOS, inside their hours, government vets first, at most 15 (route `vet_escalation`), then queues `send_sos_push` | Park |
| `sweep_v7` | `apps/worker` `enqueueDailyIfDue` | Daily | v7: deletes each document 30 days after its decision (an unattached upload after a day: file first, then `deleted_at`, the row stays), deletes retired or rejected avatar files after the 30-day restore window, deletes WebAuthn challenges a day past expiry, and tells a dog's feeders a week before a vet-signed vaccination is due | Park |
| `drive_headsup` | `apps/worker` `enqueueDailyIfDue` (hourly) | Per drive, the day before | v7 N5: one push to the feeders of a drive's dogs, once (`headsup_sent_at`; moving the date clears it) | Park |
| `send_feeder_push` | `apps/api/src/lib/dog-feeders.ts` `enqueueFeederPush` (tag reports, status reports, the "Looks unwell" tell-co-feeders push; v7's vaccine-due and drive reminders) | Per event, per recipient | Every non-SOS push to feeders (design v5). Skips a feeder whose `alerts_mode` is `sos_only`; inside a feeder's quiet hours it re-queues itself for the end of the window. SOS pushes never go through it and never wait for quiet hours | Park; `PUSH_ENABLED` false → degrade |

### 7. The fifteen invariants: what enforces each

| # | Invariant | Enforced by |
|---|---|---|
| 1 | Slugs random, non-sequential, base32 | `packages/db/src/slugs.ts` + 500-gen uniqueness & check-char tests |
| 2 | Anonymous geo: ward / ≥500 m cells, ≤2 decimals | `packages/contracts/src/geo.ts` + tests; `dogs.ts` route test |
| 3 | `identity_hmac` only (HMAC-SHA256 pepper), never bare contact | `lib/hmac.ts`; schema has no bare `phone`/`email` column; `ops/security-gate.sh` grep. Since v6 public pages name feeders by first name only, with an opt-out (`lib/public-name.ts`, `feeders.show_first_name`). Since v7 the rule covers feeders and reporters; verified vets' and NGOs' professional numbers are public, like the care directory's |
| 4 | LWW on `dogs.last_seen_geo` by `captured_at` (±15 min future, 30 d past), tie-break `received_at` | `scans.ts` `applyLww` + `0002_*` columns; test |
| 5 | `scans.client_uuid` UNIQUE (offline replay idempotency) | Unique index + scan replay test (`created:false`) |
| 6 | Rate limits per account / device token, never per IP | `device.ts` tokens as write subject; `lib/rate-limit.ts`. The documented exceptions, each paired with a subject or global bucket, are token minting, the two finding reads, tag reports and the dogless SOS (`docs/INVARIANTS.md` #6) |
| 7 | Anonymous SOS attested + capped (2/day, 5/week) | `sos.ts` per-device-token for anon, per-account for feeder-authed; rolling 24 h/7 d windows; a dogless SOS adds its own tighter limits |
| 8 | `medical_records` append-only (no UPDATE/DELETE/TRUNCATE) | `0001`/`0012` REVOKE + `BEFORE TRUNCATE` trigger; `app_user` UPDATE/DELETE negative test. v7's vet signatures, corrections and withdrawals are new rows through the one chain writer; v7's `audit_log` is append-only the same way, with its triggers in migration 0029 |
| 9 | Ledger hash-chained, length-prefixed payloads | `@hetja/ledger` `hashInput` + `medical.ts` chain write under advisory lock; Merkle root per append (0014), `GET /api/v1/ledger/proof` |
| 10 | Daily published anchor | Worker `anchor_ledger` job + `sign-anchor.ts` EdDSA when key configured; `ledger.ts` serve+verify. **Not yet published externally**: `published_url=''` (see “Deliberately not finished”) |
| 11 | DPDP erasure = PII delete, chain stays valid | Pseudonymous actor IDs in chain; `dogs.registered_by ON DELETE SET NULL`, runbook documents erasure |
| 12 | Every documented query `EXPLAIN`s | `ops/check-queries.sh` CI gate |
| 13 | Scan landing < 40 KB gzipped | `pnpm --filter @hetja/scan size:gate` |
| 14 | AI validation flags, never silently rejects | `apps/ai/worker.py` stub → `flagged`; moderation queue test |
| 15 | Verification gates: provisional feeders auto-paused after 3 serial rejects | `lib/trust.ts` gate + `trust.test.ts` |

*Numbering warning from `docs/INVARIANTS.md`: in migrations and CI “INVARIANT 9”
means append-only (the table’s #8), because the original spec numbered it that
way and the applied migration headers were deliberately not rewritten. New code
uses the canonical numbers above. Trust deltas are `TRUST_BASELINE=30`,
`feed+1`, `verified_scan+10`, `photo_accepted+10`, `sos_ack+20`,
`photo_rejected-5`, `story_rejected-5`, `serial_rejects-15`, `auto_paused 0`,
`reversal 0`, exactly as in `apps/api/src/lib/trust.ts`.*

### 8. Ops

**Gate ladder (same locally and in CI):**

```bash
pnpm install --frozen-lockfile
pnpm --filter @hetja/ledger build; pnpm --filter @hetja/contracts build; pnpm --filter @hetja/db build
pnpm -r typecheck
bash ops/security-gate.sh       # no DB
bash ops/contrast-gate.sh       # the 22 text/background pairs (v4 + v5's vet pill), AA
bash ops/check-queries.sh       # every docs/queries/*.sql EXPLAINs against a *_test DB
pnpm --filter @hetja/scan build && pnpm --filter @hetja/scan size:gate
# tests (api/worker/db need a `*_test` database; the suite refuses anything else;
# the WSL recipe is AGENTS.md §f):
pnpm test                       # = pnpm -r --workspace-concurrency=1 test
```

**Deploy pipeline (`push → main`, `.github/workflows/deploy.yml`):**

```
push → Gate    (typecheck, tests, security, EXPLAIN, 40 KB, contrast, Caddy cache, systemd)
     → Migrate (destructive-change gate, read-only Supabase report, apply to Supabase)
     → Deploy  (build everything ON THE RUNNER, one tarball, scp as `hetja`,
                hetja-deploy <id>: unpack, validate, flip releases/current, stamp;
                root path unit restarts hetja-*; health-check up to 180 s,
                roll back to the previous release if unhealthy; public check via Cloudflare)
```

- Nothing is built on the box: it is shared with an agent that has priority
  (`ops/room/README.md`).
- Migrations reach **one** database, Supabase. Only additive migrations flow
  unattended; anything destructive needs a `-- MIGRATION-APPROVED:` marker and
  a human.
- Rollback covers **code, not schema**: `current` flips back, but an applied
  migration stays applied. Safe only because unattended migrations are
  additive.
- The monthly vet/NGO refresh is a separate manual workflow,
  `care-import.yml`: dry-run by default, apply only with a typed confirmation,
  retires missing rows (`listed = false`) instead of deleting them, and refuses
  to retire more than a quarter of a source at once.

**Verify (on the box, as root; the same checks `hetja-deploy` runs):**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/healthz                                   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/                                          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/                                          # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: hetja.in" "http://127.0.0.1:80/api/v1/heatmap?ward=A" # 200
systemctl status hetja.target 'hetja-*'
systemd-cgtop -1 | grep hetja
```

### 9. Deliberately not finished

*In the register `HOW-IT-WORKS.md` §9 uses. Honest, not aspirational.*

- **`apps/shell` does not exist.** The native wrapper is empty, so iOS push is
  unreliable (iOS requires add-to-home-screen before Web Push works). The UI
  says so rather than implying a safety net that is not there.

- **The first-aid lines ship without a vet's sign-off, by decision.** They
  sat behind `FIRST_AID_ENABLED=false` until design v6, when the owner decided
  to ship the three N10 "While you wait" lines as designed
  (`apps/scan/src/firstaid.ts`, no flag now). The mock still asks for a vet's
  review before launch, and it is in `docs/OWNER-TODO.md`: bad first-aid
  advice given to a frightened stranger can kill a dog faster than doing
  nothing.

- **No languages.** English only; the language setting (v5 Settings row, v6
  N14) is designed and not built until human translations exist.

- **`validate_scan` has no producer.** Nothing enqueues it, so `ai_validation`
  stays `NULL`, `review_status` stays `pending` forever, and INVARIANT 15’s
  gate (provisional auto-pause after 3 serial rejects) can never fire from real
  AI output. Recorded in `JOB_PRODUCERS` as `NONE -- see docs/INVARIANTS.md`
  rather than pretended. The mechanical guard fails if a handler lacks a
  producer, so this cannot be forgotten again.

- **`published_url` is `''`, so INVARIANT 10 is not satisfied.** The daily
  ledger anchor is computed, Merkle-rooted and signed when a key is configured,
  but only ever held by us, and the invariant’s whole point is a head
  *published somewhere the operator does not solely control*. A row in our own
  database is not that. Publishing to a third party (notarisation service,
  public gist, OTS timestamp) is the remaining half; the ledger package’s
  `anchorMessage()` exists to give it a deterministic payload.

- **`s3` storage throws.** `STORAGE_BACKEND=s3` has no delete path in this
  build: the retention handler logs and returns, so photos are retained
  forever when that backend is selected. The `local` path is the only one that
  actually deletes. Implementing s3 before relying on the TTL is a prerequisite,
  not a follow-up.

- **Most care coordinates are locality estimates and no phone number is
  verified.** About 81 of 93 providers carry `geo_precision='locality'` and a
  `locality` label rather than a measured address, so their `distanceM` is
  `null` by contract (never a confident 0 m). Every `phone_verified_at` is
  `NULL`; nobody has called these numbers. Geocoding from a real address and
  calling each number are the only honest ways to close those gaps; there is no
  shortcut.

- **The old box's four databases were `SQL_ASCII` / `C` collation**, which
  bites Devanagari dog or feeder names on ordering and case-folding. Supabase,
  now production, has not been re-checked; changing collation is a
  dump-and-restore, so it is recorded rather than fixed.

- **Production connects as Supabase's `postgres` user**, so the `app_user`
  REVOKEs the tests reproduce do not bind the live API; INVARIANT 8 there rests
  on the trigger in `ops/supabase/03_hardening.sql`. Check it exists.

- **No backups run for the room.** The restic and `pg_dump` timers belonged
  to the old box; uploaded photos in `/srv/hetja/photos` are not backed up.

- **Tier-2 escalation to contracted vets and the municipal desk is recorded,
  not delivered.** The worker writes `sos_notifications` rows (`sms`, `bmc`)
  that nothing sends: there is no SMS provider and no desk integration. They
  are not counted as told anywhere ("told means delivered", migration 0028's
  review). What reaches people is Web Push to feeders, to v7's NGO
  coordinators and verified vets, and the numbers on the reporter's screen.

- **A `serious` SOS tells only the dog's own feeders when it is filed**
  (`notify_only` rows below the trust floor, migration 0028). "Hurt, but
  moving" and "Something else" do not fan out city-wide; only a critical
  report does.

- **The collar page has no "lost" state.** A dog reported not seen is `lost`
  and its ward is asked to look out, but a stranger sees the ordinary page.

- **v7 gaps, recorded rather than hidden.** Avatars and duplicates are matched
  by name, never by photo (no image model fits the room). The MSVC register is
  checked by an admin by hand. The audit log misses a few smaller writes
  (avatar uploads, NGO ambulance and beds, dispatch accept and decline, drive
  edits, a vet's own profile and sign-request declines). There is no route to
  cancel a drive or revoke an invitation, and a suspended vet's signatures can
  be flagged only by removing the vet. A taken-down photo is hidden from every
  API response but its file waits for the 7-day retention. The collar page
  has about 600 bytes of its 40 KB budget left.

- **The re-tag route is not a separate endpoint yet.** A replacement tag keeps
  the same slug and the print page keeps returning the same `collarUrl`, so a
  reprint works; there is no dedicated retag API beyond that.

- **The git history still contains the old working title in commit messages.**
  Rewriting it invalidates every SHA, so it happens once, last, and not before.

---

*The rule underneath: the system is allowed to know less than it wants to, but
it is not allowed to claim more than it knows. A measurement we don’t have is
not reported as zero (§10 of `HOW-IT-WORKS.md`).*
