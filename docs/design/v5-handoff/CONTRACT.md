# Design v5: build contract

The v5 handoff (this folder) adds four boards to design v4:

| Board | File | Screens |
|---|---|---|
| Audit of hetja.in | `Hetja Audit and New Pages.dc.html` (top) | 6 audited screens + "Across every screen" |
| Pages the site is missing | same file (bottom) | N1 to N9 |
| Register and print | `Hetja Register and Print.dc.html` | R1 to R8 |
| When a tag breaks | `Hetja Tag Problems.dc.html` | F1 to F6 |
| Printable sheets | `Hetja Collar Sheet A4.dc.html` | 3 A4 pages |

Rendered boards: `Hetja_*.jpg` next to them. The screenshots in
`uploads/hetja-current/` are of a build older than v4; many audit items are
already fixed. Check each one against the running v4 app and fix what remains.

Rules carried over from v4 (AGENTS.md section c): verify every screen side by
side against its mock at 390 x 844; ship **all** mock copy verbatim (example
data such as Rani, Priya S., K/W is data, not copy); no em dashes; one loud
button per screen; 44 px targets; mobile first.

## Owner decisions (2026-09-25)

- **No languages yet.** The Settings "Language" segment (English / हिंदी /
  मराठी) is left out until human translations exist.
- **Five tabs:** Home, Scan, Map, Alerts, Me.
- Everything else in the boards ships.

## Adapted, not verbatim (and why)

| Mock | What ships | Why |
|---|---|---|
| QR encodes `HTTPS://HETJA.IN/D/<CODE>` (alphanumeric, unsigned) | The existing signed collar URL from `lib/qr.ts` (`https://hetja.in/d/<slug>?s=<sig>`) at the mock's printed sizes | INVARIANT: collar QRs are HMAC-signed. At 22 mm the version-5 grid is 0.49 mm per module, inside what a phone reads. |
| Tag on the wrong dog: "Feeds and SOS on that code pause until a feeder checks" | Feeds on that code earn no trust and the profile shows "Tag under review" until a feeder checks. **SOS is never paused.** | An anonymous report must not be able to switch off SOS for a dog. |
| F1 "Dog is hurt · Send SOS anyway" with no dog identified | Opens the nearest vets and NGOs for the caller's location (Call buttons), then "Find by ward and photo" so the SOS can reach the dog's feeders | The SOS pipeline pages feeders of a known dog; a dogless SOS pages nobody. |
| N6 Language row | Omitted | Owner decision above. |
| R7 "Download PDF" / "Send to a print shop" | A real PDF built in the browser (vector QR, exact mm); "Send to a print shop" shares that PDF with the Web Share API, falling back to a download | No server-side PDF rendering in the room. |
| R6 flow ends at "Rani is on Hetja." | Same, plus the existing activation line (first scan switches the tag on) | Registration activation is an abuse control (INVARIANTS, registrations lifecycle). |
| R-board "Email or phone code" | Email code only | Hetja has no SMS. |
| N9 "keeps their page, with the names of everyone who fed them" | For a deceased dog only, the first name and initial of each signed-in feeder who fed them | Feeder identity is otherwise never public. |
| N1 "We only alert you about dogs in these wards." | Wards filter paging exactly as the copy says (see API section) | |

## Routes and who owns them

Only the five tab roots show the TabBar. Every other app screen is a focused
screen: 52 px header with a back or Cancel, no tab bar, no footer. The website
footer appears only on the reading pages (About, How it works, FAQ, Privacy,
Contact) and on Home at desktop width.

| Route | Screen | Owner |
|---|---|---|
| `/` | Home (audit fixes) | chrome |
| `/login` | Sign in, full-screen with Cancel (audit) | chrome |
| `/welcome` | N1 Become a feeder (after first sign-in when `onboarded` is false) | chrome |
| `/alerts` | N5 Alerts (tab) | chrome |
| `/settings` | N6 Settings | chrome |
| `/me` | Me hub: signed out ("Me" + what signing in unlocks + one blue Sign in), signed in (name, streak, links to My dogs, Register a dog, Settings) | chrome |
| `/hetja`, reading pages | audit fixes | chrome |
| `/map` | its tab bar becomes the shared five-tab TabBar | chrome |
| `/scan` | camera opens directly; F1 sheet after 6 s without a read | scan |
| `/scan/code` | F2 partial code, and N8 "No dog has this code." with "Did you mean" | scan |
| `/scan/find` | F3 Find by ward and photo (also the F1 SOS-anyway path, `?sos=1`) | scan |
| `/register` | R1 Start | register |
| `/register/new` | R2 Photo, R3 Duplicate check, R4 About the dog, R5 Check and confirm (one client flow, steps 1 to 4) | register |
| `/register/[slug]/ready` | R6 Code ready | register |
| `/register/[slug]/print` | R7 Print tag (three layouts, A4 / Letter, PDF) | register |
| `/register/batch` | R8 Batch sheet (up to 8 dogs) | register |
| `/me/dogs` | N4 My dogs | care |
| `/me/dogs/[slug]/status` | N9 Update on a dog | care |
| `/me/dogs/[slug]/tag` | F6 Feeder tag alert, reprint, tag history | care |
| `/vet/[slug]` | N3 Checkup record (vet accounts) | care |
| `/sos/[caseId]` | N2 SOS alert (I'm going / I can't go right now) | care |
| `/feed` | N7 No signal state (feed saved, sends later) | care |
| `/d/<slug>` (apps/scan) | F4 Report a tag problem sheet, F5 Found tag reported, Unverified badge, Tag under review, memorial state, N8 on a typed-code miss | scan-app |

## API additions (all additive; envelope `{ ok, data }`; base `/api/v1`)

### Migration `0026_v5_tags_status_profile.sql`

- `feeders`: `wards TEXT[] NOT NULL DEFAULT '{}'`, `quiet_start SMALLINT`,
  `quiet_end SMALLINT` (minutes after midnight, Asia/Kolkata),
  `alerts_mode TEXT CHECK (alerts_mode IN ('sos_only','all'))`,
  `onboarded_at TIMESTAMPTZ`, `deleted_at TIMESTAMPTZ`.
- `dogs`: `markings TEXT[]`, `verified_at TIMESTAMPTZ`,
  `verified_by UUID REFERENCES feeders(id) ON DELETE SET NULL`,
  `verified_via TEXT CHECK (verified_via IN ('vet','feeder'))`,
  `tag_review_since TIMESTAMPTZ`.
- `sos_notifications`: `declined_at TIMESTAMPTZ`.
- `tag_reports`: id, dog_id, kind (`damaged`, `found_on_ground`, `wrong_dog`,
  `too_tight`), reporter_feeder_id (nullable), reporter_device (a hash, never
  the raw token), created_at, resolved_at, resolved_by, resolution
  (`reprinted`, `spare`, `checked_ok`).
- `tag_prints`: id, dog_id, printed_by, layout (`tags`, `notice`, `batch`),
  paper (`a4`, `letter`), tag_count, printed_at.
- `dog_status_reports`: id, dog_id, kind (`not_seen`, `adopted`,
  `passed_away`), reported_by, created_at, confirmed_by, confirmed_at.

"Feeder of a dog" below means: the registrator, or a signed-in feeder with a
feed scan of that dog in the last 60 days.

### Profile

- `GET /feeders/me` adds `wards: string[]`, `quietHours: { start: "HH:MM", end: "HH:MM" } | null`,
  `alertsMode: "sos_only" | "all"` (default `all`; `sos_only` is an explicit choice in Settings), `onboarded: boolean`,
  `publicName: string` (first name and initial, e.g. "Priya S.").
- `PATCH /feeders/me` also accepts `displayName` (1 to 40 chars), `wards`
  (0 to 6 BMC ward ids), `quietHours` (or null), `alertsMode`,
  `onboarded: true`.
- Paging: when `wards` is non-empty a feeder is paged only for dogs in those
  wards, and is eligible for any dog in them (as well as by recent-feed
  proximity). Trust floors are unchanged. Quiet hours hold back every push
  except SOS.
- `GET /feeders/me/export`: the caller's own data as a JSON download.
- `DELETE /feeders/me` with `{ "confirm": "DELETE" }`: anonymise (name becomes
  "Former feeder", identity HMAC replaced, SOS opt-in off, push subscriptions
  and refresh tokens removed). Registered dogs and feed logs stay. Answers
  200 `{ deleted: true }` (the web client parses every response as JSON).

### Alerts

`GET /feeders/me/alerts` returns `{ items: Alert[] }`, newest first, last 14
days, at most 50:

```ts
type Alert = {
  id: string;
  kind: "sos" | "tag" | "verified" | "fed" | "not_seen" | "status";
  at: string;                       // ISO
  dog: { slug: string; name: string | null } | null;
  wardCode: string | null;          // "K/W"
  actorName: string | null;         // "Anil", "Dr Mehta"; public names only
  detail: string | null;            // e.g. feed note, "vaccinated,sterilised", tag kind
  href: string;                     // web route to open
};
```

### My dogs

`GET /feeders/me/dogs`: every dog the caller registered or fed in 60 days.
`MyDog` gains `photoUrl`, `status`, `verified`, `registeredByMe`,
`lastFedByName` (public name or null), `myLastFedAt` becomes nullable, and
`attention: null | { kind: "sos" | "tag" | "missing" | "vet" | "new"; since: string; detail: string | null }`
(`vet` carries the due month, e.g. "2026-10").

### Verification

- `POST /dogs/:slug/confirm`: a signed-in feeder of the dog who is not its
  registrator (and not on the registering device) confirms it.
  `{ verified: true, via: "feeder" }`.
- `POST /dogs/:slug/checkups` (vet role): `{ rabies: "given_today" | "up_to_date" | "due", sterilised: boolean, nextVaccineDue?: "YYYY-MM", noteForFeeders?: string, examined: true }`.
  Writes medical records through the existing ledger path and verifies the
  dog. `{ verified: true, via: "vet" }`.

### Finding a dog

- `GET /dogs/lookup?code=<9 chars, ? for unknown>`: normalises case, `0`→`o`,
  `1` and `l`→`i`; needs at least 4 known characters. Returns
  `{ exact: DogCard | null, matches: DogCard[], suggestions: DogCard[] }`
  (at most 5 each). `suggestions` are dogs one swap or one character away
  from a full 9-character miss. Active and lost dogs only. Rate limited.
- `GET /wards/:wardId/dogs?colour=brown|black|white|spotted`: returns
  `{ wardId, total, colourTotal, dogs: DogCard[] }` (at most 30). Active and
  lost dogs only. Rate limited.
- `DogCard = { slug, name, wardId, wardCode, photoUrl, markings: string[], lastSeenAt: string | null }`.

### Tags

- `POST /dogs/:slug/tag-reports` (device token or Bearer; no sign-in
  needed): `{ kind }`. Returns `{ reportId, feedersNotified, wardCode }`.
  Deduplicated per device, dog and kind for 24 h. Pushes the dog's feeders.
  `wrong_dog` sets `tag_review_since`.
- `GET /dogs/:slug/tags` (feeder of the dog):
  `{ open: TagReport[], history: TagEvent[], reportsThisWeek: number, sturdierCollarSuggested: boolean }`
  (`sturdierCollarSuggested` once there are 3 reports in 7 days).
- `POST /dogs/:slug/tag-reports/:id/resolve` (feeder of the dog):
  `{ resolution: "reprinted" | "spare" | "checked_ok" }`. `checked_ok` clears
  the review.
- `POST /dogs/:slug/prints`: `{ layout, paper, tagCount }` records a print
  for the history.
- `GET /dogs/:slug/collar` (registrator or feeder of the dog):
  `{ slug, name, wardId, collarUrl }`. `POST /collars/batch` with
  `{ slugs: string[] }` (1 to 8) returns `{ dogs: [...], skipped: string[] }`.

### Dog status

- `POST /dogs/:slug/status-reports` (feeder of the dog): `{ kind }`.
  `not_seen` sets status `lost` and pushes that ward's feeders to look out;
  `adopted` sets `adopted`; `passed_away` waits for a second feeder.
  Returns `{ id, status, needsConfirmation }`.
- `GET /dogs/:slug/status-reports` (feeder of the dog): the pending ones.
- `POST /dogs/:slug/status-reports/:id/confirm` (a different feeder of the
  dog): sets `deceased`.
- A feed or view scan of a `lost` dog sets it back to `active`.

### Public dog profile (`GET /dogs/:slug`) adds

`verified: boolean`, `tagUnderReview: boolean`,
`sturdierCollarSuggested: boolean`, and for deceased dogs only
`memorial: { feederNames: string[] }`.

### SOS

- `GET /sos/cases/:id` adds `dog: { slug, name, photoUrl } | null`,
  `reporterPhotoUrl`, `note`, `respondingName`, `respondersPaged`,
  `nearestCare: { name, phoneE164 } | null`, `declinedByMe`, and
  `location: { lat, lng } | null`, which is filled **only** for the caller
  who acked the case ("The exact spot unlocks when you tap I'm going").
- `POST /sos/cases/:id/decline` marks the caller's page as declined. It
  never affects escalation.

### Registration

`POST /registrations` also accepts `photoBase64` (the face photo, stored
through the existing photo gate as the dog's portrait) and `markings`
(at most 8 short strings).
