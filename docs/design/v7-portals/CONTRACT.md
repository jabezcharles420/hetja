# Design v7: Admin, Vet and NGO portals

Board: `Hetja Admin Vet NGO Portals.html` (a bundled page: open it in a
browser; `portals-text.txt` is its visible text per screen, and
`Hetja_Admin_Vet_NGO_Portals.jpg` the full render). Screens: A1 to A7 (admin),
V1 to V5 with V2b (vet), N1 to N5 (NGO). The grey paragraph under each mock is
spec. The same rules as v4 to v6 apply: side-by-side verification, all copy
verbatim, no em dashes, one loud button per screen.

Some screens are **designed here, not in the board**: the admin sidebar
sections with no mock (Dogs, Feeders, Collars, SOS cases, Reports, Settings),
and the vet and NGO screens the board links to but does not draw (see
"Screens to design"). Build them in the board's visual language: A1's
sidebar and list-with-detail layout for admin, and the v4/v6 phone patterns
for vet and NGO.

## Owner decisions (2026-09-25, third round)

- **Vet and NGO phone numbers are public.** They exist to be called.
  Vets and NGOs are professional contacts, not feeders: their numbers show
  on public pages (SOS sent, map, dog pages) like the care directory's.
  Feeders' contact details stay HMAC-only (INVARIANT 3 is rescoped to
  feeders and reporters, not professionals).
- **Government vets are free, and Hetja says so.** The owner will upload a
  database of government vets and NGOs. Wherever a government vet or
  hospital appears, it is labelled "Government vet · free" (or "Government
  hospital · free"). Private clinics show their cost tier as today.
- **Documents stay private.** Registration certificates and photo IDs are
  encrypted at rest, readable by admins only, and deleted 30 days after the
  application is decided. They are never public.
- **Role tab bars:** vets get Home, Map, Vet, Me; NGO members get Home,
  Map, NGO, Me. Scan moves inside the Vet or NGO tab ("Scan a collar"). A
  member who is both a vet and an NGO member gets the NGO tab and the Vet
  tools inside it. Everyone else keeps Home, Map, Scan, Me.
- **First Owner:** set through a GitHub secret `HETJA_OWNER_EMAILS` written
  into `api.env`; the API grants the Owner role to an account whose identity
  HMAC matches. No email is committed to the repo.
- **admin.hetja.in** needs a new public hostname on the Cloudflare tunnel
  (owner action, in OWNER-TODO). Caddy routes that host to the web app's
  `/admin`. Until the hostname exists, the portal also works at
  `hetja.in/admin`.

## Adapted, not verbatim (and why)

| Mock | What ships | Why |
|---|---|---|
| A2 "Found on the MSVC register · valid to Mar 2029" | An admin checklist item "Checked on the MSVC register" with a link to the council's public register; the admin ticks it and can note the validity date | There is no public API for the MSVC register. |
| A3 "By photo · 94%" matching, A5 "92% photo match" | Matching by dog ID (slug) and collar batch number in the file name; everything else goes to "No match · pick dog". Duplicate suggestions come from reports and from same-ward similar names | Photo similarity needs an image model; the shared box's 360 MB room cannot run one. The `cv_embedding` column stays for later. |
| V3 "Sign with Face ID" | A passkey (WebAuthn) assertion over the record's hash: Face ID, fingerprint or the phone's screen lock, whichever the phone offers | That is what Face ID signing is on the web, and it makes the signature verifiable. |
| Collar numbers "HJ-0412" | The collar's `batch_no` where set, else the 3-3-3 code | Hetja's collar identity is the slug. |
| A7 "Thane Street Dogs · Thane" | NGOs may only cover Mumbai wards | Hetja is Mumbai only. |
| V4 vaccination certificate "PDF" | A PDF built in the browser from vet-signed records, like the collar sheets | |

## Roles and access

- **Admin roles** (A6): Owner (everything, including removing vets and team
  members), Moderator (verify vets, merge dogs, reports, SOS), Avatar editor
  (avatars only), Ward lead (collars and SOS in their wards). Every admin
  action writes the audit log.
- **Audit log:** append-only for everyone including the Owner (no UPDATE,
  DELETE or TRUNCATE for `app_user`, a trigger as for `medical_records`),
  exportable as CSV.
- **Vet:** a feeder whose vet application is verified. Keeps every feeder
  action. Suspended: cannot sign or accept SOS; past signatures stay valid
  unless an admin flags them. Removed: signatures stay (default) or are
  flagged for re-check.
- **NGO member:** coordinator (invite and remove, vouch, dispatch),
  rescue, collars, volunteer; vets linked to the NGO. Paused NGO: no new SOS
  routing. Removed: vets unlinked, verification kept.

## Data (migration `0029_v7_portals.sql`, additive)

- `admin_roles` (feeder_id, role, wards[], granted_by, granted_at,
  revoked_at) and `audit_log` (append-only; actor, action, subject type and
  id, detail JSON, at).
- `vet_profiles` (feeder_id, council, reg_no, clinic, wards[], sos_available,
  sos_hours, public_phone, status: invited, waiting, more_info, verified,
  suspended, declined, removed; register_checked_at/by, valid_to, decided
  by/at/reason, vouched_by_ngo_id, care_provider_id link).
- `documents` (owner kind and id, kind: certificate, photo_id, ngo_registration;
  encrypted blob key, sha256, uploaded_at, delete_after).
- `ngos` (name, reg_type, reg_no, since, 80G flag, wards[], offers: ambulance,
  shelter_beds, sterilisation, collars; contact name and public phone,
  ambulance count, hours and status in/out, beds total and free; status:
  waiting, active, paused, removed; care_provider_id link) and `ngo_members`
  (ngo_id, feeder_id, role, has_transport, invited_by, joined_at, left_at)
  and `ngo_vets` (ngo_id, vet feeder_id, vouched_at).
- `sign_requests` (dog, requesting feeder, proposed record payload, evidence
  photo, status: open, signed, declined; vet, decided_at).
- `webauthn_credentials` (feeder_id, credential id, public key, counter,
  transports, created_at, last_used_at). Vet-signed `medical_records` carry
  the signing vet, the credential id and the assertion over the record hash;
  corrections are new records with `supersedes` and a reason; withdrawals are
  records of type `withdrawal`. Nothing in `medical_records` is updated.
- `dog_avatars` and `avatar_batches` (file, matched dog, match kind, status
  draft/published/retired, uploaded_by, published_at, feeder sign-off
  requested/answered). The real photo stays the dog page's record of truth;
  the avatar is for map pins, lists, share cards and the collar print.
- `dogs.merged_into` and `dog_merges` (kept, merged, by, at). A merged dog's
  slug redirects to the kept dog; its scans and medical records are read
  with the kept dog's (the ledger is never rewritten).
- `reports` (kind: duplicate_dog, photo, other; subject dog ids, reporter,
  note, status, resolved_by/at/outcome).
- `sos_dispatches` (case, NGO, assigned member, sent_by, sent_at, accepted_at,
  declined_at) for N3; SOS routing: feeders nearby first (as today), then
  the NGO covering the ward (coordinators get it and "Send someone"), then,
  after 15 minutes with nobody accepting, every vet nearby. An admin can
  "Assign a vet" at any time (A1).
- `drives` and `drive_dogs` (NGO, ward, date and time, lead vet, volunteers;
  per dog: tasks collar, vaccinate, sterilise, and status). A worker job
  gives the dogs' feeders a heads-up the day before.
- Care directory: the monthly CSV gains government vets as people
  (name, registration number, public phone, wards, `is_government`) next to
  hospitals and NGOs; a verified vet account can be linked to its directory
  entry.

## API (all under `/api/v1`, envelope `{ ok, data }`)

- **Admin** (`/admin/*`, admin roles only, every write audited): today
  summary and "needs you" list (A1), global search, vets list and detail with
  verify, ask for more, decline, suspend, remove (A2), invite a vet, avatar
  batches (upload, match, publish, replace, ask the feeder) (A3, A4),
  duplicate candidates and merge (A5), team, roles and the audit log with CSV
  export (A6), NGOs list and detail with approve, pause, remove, edit (A7),
  plus the designed sections: dogs, feeders (trust, suspend, block device:
  the D13 moderation tools), collars, SOS cases (assign a vet), reports,
  settings. Documents stream to admins only.
- **Vet:** apply with documents (V1), vet home (SOS near you, sign requests,
  due soon) (V2), vet view of a dog (V2b), passkey registration and signing
  of vaccination, sterilisation and treatment records (V3), public health
  list on the dog page (V4), correct or withdraw (V5), my signatures.
- **Feeder side of signing:** "Ask a vet to sign" on a feeder-noted record
  (V4), and feeders can note care themselves ("Feeder noted").
- **NGO:** register with documents (N1), NGO home (SOS in wards, ambulance,
  beds, team, drives, dogs in wards) (N2), dispatch (N3), team and vouching
  (N4), drives (N5).
- **Public:** vets and NGOs in the care lookups carry `isGovernment`,
  `publicPhone` and the "free" cost tier; the dog page's health list shows
  "Vet signed" (vet name, council number, batch) or "Feeder noted".

## Screens to design (not in the board)

| Area | Screen |
|---|---|
| Admin | Dogs (search, one dog: history, photos, avatar, collar, status, merge), Feeders (search, one feeder: trust, dogs, feeds, reports, suspend, block device), Collars (issued, reprints, reissues, batch numbers), SOS cases (open, escalated, unassigned, assign a vet), Reports (duplicates, photos, tag reports, fake tags), Settings (read-only view of the rules: SOS timings, budgets, limits), Invite a vet, Add an NGO, Add someone to the team, the mobile "Admin works on a laptop" page |
| Vet | Application status (waiting, asked for more, declined), My signatures, Due soon list, Vet profile (wards, SOS hours, public phone, clinic), passkey setup |
| NGO | Application status, Dogs in your wards, New drive, Invite to the team, Ambulance and beds update sheets, NGO profile |

## Owners

| Area | Builder |
|---|---|
| Migration 0029, API, worker, care import extension, owner bootstrap | api |
| Admin portal (`apps/web/app/admin/**`, desktop) | admin |
| Vet portal (`apps/web/app/vet/**`, the Vet tab, V2b, V3 signing with passkeys, V5, the certificate PDF) | vet (the care builder, who built N3) |
| NGO portal (`apps/web/app/ngo/**`, the NGO tab, N1 to N5) | ngo (the register builder) |
| Role tab bars, Me rows ("Sign records as a vet", "Bring your NGO to Hetja"), the desktop invitation exemption for `/admin`, "Government vet · free" labels in the web app | chrome |
| V4 health list and "Government vet · free" labels on the collar page, within the 40 KB budget | scan-app |
