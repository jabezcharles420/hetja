# StrayNet — Research Note 1

**Scope:** philosophy, real-world fit, data ethics/custody, volunteer retention.
**Method:** repo walk-through (`README.md`, `packages/db/migrations/*.sql`, `docs/queries/*.sql`,
`apps/*`, `ops/RUNBOOK.md`) + web research (India-specific sources, geoprivacy literature,
citizen-science retention literature). Research only — **no code was modified.**
**Status:** v1, for review.

---

## 0. Executive summary

StrayNet is best understood not as *an app about dogs* but as a **coordination and trust layer
over an existing, mostly-informal ecosystem** — feeders who already know "their" dogs and
territories, NGOs that already run ABC drives/OPDs/adoption (e.g. WSD's ~15,000 on-site
treatments/yr), and BMC's ABC machinery (90,757 dogs surveyed in 2024; ~57 sterilised/day;
₹23 cr approved for 33,671 more). The QR collar is the **stable primary key** that turns "the
brown dog near Building C" into a verifiable identity with a medical ledger, a last-seen point,
a feeding history and a story. Everything else is a service on top of that identity graph.

The philosophy implies several **missing features** (§1): BMC/NGO ABC-report handshake, feeder
onboarding + mentorship, adoption workflow, lost-dog alerts, org-capacity SOS routing, and the
anonymous-scanner → care conversion funnel.

The reality of the Indian market (§2) says: **WhatsApp (531 M Indian users) is both the
competitor and the substrate** — build SOS/notification and photo-reporting on the WhatsApp
Business API and keep the PWA as the identity/ledger layer; **Jio is behind CGNAT and its 5G is
IPv6-only in places** — no inbound sockets, so push must be FCM/WebPush + SMS and offline-queue +
flush-on-open (already implemented) is non-negotiable; **the monsoon treats collars as
consumables** — plan 1/yr replacement and a "sighting without collar" (visual-ID) path.

The dataset is **dual-use** (§3): a geotagged register of strays is also a map of feeding spots,
feeder identity and medical provenance. Recommended custody model (iNaturalist-geoprivacy-style):
store exact points privately, expose only coarsened geometry by role/purpose tier, enforce
k-anonymity on the public heatmap, treat `phone_hmac` as pseudonymous (linkable) personal data
under the DPDP Act 2023, and ship a breach runbook.

Retention (§4): the citizen-science literature is consistent — **games attract but don't retain;
community, visible feedback and being valued retain**. Keep streaks/badges (schema already has
`streak_days`/`badges`) but weight them to quality, compute recognition offline-first, and build
the "impact moment" narrative loop (dog stories → "you healed Rosie").

Ranked, action-ready recommendations are in §5.

---

## 1. Philosophy: a coordination layer, not an app

### 1.1 What the system fundamentally is

- **Primary key = the collar.** The QR slug (`SLUG_REGEX /^[a-z2-7]{9}$/`) is HMAC-signed
  (`collars.hmac_sig`), non-sequential (INVARIANT 1), and is what a stranger scans with zero
  install. This is the "protocol" move: identity precedes any UI.
- **The ledger is the accountability spine.** `medical_records` is append-only, hash-chained,
  publicly anchored daily (INVARIANT 10). Its real purpose is *cross-institution trust*: BMC,
  NGOs, vets and feeders don't currently have one shared source of truth for "is this dog
  sterilised/vaccinated/treated".
- **SOS is a routing problem, not a notification problem.** The interesting schema is
  `feeders_sos_gix` (partial GIST on `sos_opt_in AND trust_score >= 40`) and the 8-min
  escalation job — it is trying to answer "who near this point is *able* and *trusted* to act".
- **Trust + gamification exist to scale moderation, not to be a leaderboard.**
  `trust_score`, `trust_events`, `verification_tier`, `streak_days`, `badges` are the
  governance mechanism for a system with no paid staff at the edge.

So StrayNet = **identity + provenance + routing + trust for an ecosystem that already exists.**
Design every feature against that test: *does this multiply the capacity of an existing feeder /
NGO / vet / BMC actor?*

### 1.2 Features the philosophy implies but the repo does not (yet) have

Every item below is a *missing loop* that the current schema sketches but no workflow completes.

**M1 — BMC/NGO ABC-report integration and drive scheduling.**
`dogs.abc_status` and `medical_records.abc_date` exist, but there is no inbound feed from BMC's
ABC programme (434,529 dogs sterilised by Aug 2025; ₹23 cr for 33,671 over the next 3 years) and
no ward-level "coverage gap" view. A one-way, signed import (BMC/NGO → StrayNet) plus a
per-ward sterilisation/vaccination coverage report turns StrayNet into the shared dashboard the
ABC system lacks. Source: [FPJ — ₹23 cr sterilisation plan](https://www.freepressjournal.in/mumbai/mumbai-bmc-plans-sterilisation-of-45000-stray-dogs-annually-allocates-23-crore-for-control-drive), [HT — 90,757 surveyed](https://www.hindustantimes.com/cities/mumbai-news/90757-stray-dogs-in-mumbai-birth-control-measures-to-be-expedited-maha-101765308162813.html).

**M2 — Feeder onboarding + mentorship.**
New feeders start `provisional` at `trust_score 30` with no path. `feeder_territories` exists but
nothing assigns a buddy/mentor, no shadow-feed verification, no territory hand-off on life
events. The philosophy (coordination of humans, not dogs) requires an explicit
provisional→verified pipeline where a veteran feeder vouches for a newcomer in a shared
territory. Source: [WSD — volunteer manager / on-site team model](https://www.wsdindia.org/), [T&F — volunteer motivation & retention review](https://www.tandfonline.com/doi/full/10.1080/09640568.2020.1853507).

**M3 — Adoption workflow.**
`dog_status` includes `adopted` but there is no `adoptable` flag, no interest/screening checklist,
no home-check, no post-adoption follow-up. Mumbai NGOs already run screened adoption (WSD:
interviews, temperament tests, vaccinations before rehoming) — StrayNet should digitise that
funnel, not replace it. Source: [WSD adoption programme](https://www.wsdindia.org/).

**M4 — Lost-dog alerts.**
`dog_status = 'lost'` exists but there is no sighting-pinning flow, no shareable flyer
(slug + photo + last-seen + owner/caretaker contact), no fan-out to the 2 km ring already
implemented for SOS. Displacement is a real Mumbai failure mode (floods, redevelopment,
relocations). Source: [Citizen Matters — displaced/rabid dog response in Mumbai](https://citizenmatters.in/how-to-deal-with-rabid-stray-dogs-in-your-area/).

**M5 — SOS routing to organisations with capacity, not just individual feeders.**
`sos_fanout.sql` queries feeders only. The ecosystem's real capacity is organisations (WSD
on-site first-aid team ~15,000 cases/yr, ABC vans, clinics). Fan-out should include an
org/van tier with SLA, and the escalation job should hand off to an org when no trusted feeder
acks. Source: [WSD — on-site first aid](https://www.wsdindia.org/).

**M6 — Public scan → care conversion funnel.**
The anonymous scan page (`GET /api/v1/dogs/:slug`) returns profile + coarsened geo + vaccine
status + micro-story, but nothing converts a stranger's moment of empathy into a signal (report
a sighting, feed request, SOS, adopt, volunteer, donate). The dog story is the emotional
priming; the CTA is missing. Source: [WSD — donation/volunteer/adopt channels](https://www.wsdindia.org/).

**M7 — Collar lifecycle + "sighting without collar".**
`collars.retired_at` exists; replacement cadence, batch recall, and the "dog lost its collar"
path do not. Because collars are consumables in the monsoon (§2.4), the system must accept a
sighting with photo + visual ID (`cv_embedding` is nullable in schema — this is its purpose) and
re-issue. Source: [Protect Paws — reflective QR collars in India](https://www.protectpaws.in/).

**M8 — Ward care committees.**
`geofences`/`feeder_territories` are ownership primitives; a per-ward committee layer (who
moderates dog stories, who schedules drives, who is the BMC/NGO contact) is the social glue
that makes moderation and ABC coordination work at 100 K dogs. Source: [CSTP — collaboration as a retention driver](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.500).

---

## 2. Real world: what works / breaks in India

### 2.1 Comparable systems and what to copy

| System | What to copy | Source |
|---|---|---|
| **iNaturalist** | Offline-first observation capture; community identification; "geoprivacy" tiers; badges used as a *secondary* layer, not the core | [iNaturalist](https://www.inaturalist.org/pages/about), [Seek gamification](https://en.wikipedia.org/wiki/INaturalist) |
| **Shimla SMC QR+GPS collars** | Proof that an Indian municipality will adopt QR collars for ABC + rabies tagging — StrayNet is the natural software for these drives | [Times Now](https://www.timesnownews.com/india/first-of-its-kind-gps-enabled-collars-vaccination-drive-for-stray-dogs-in-himachal-pradeshs-shimla-article-152512787) |
| **Protect Paws / Pawsitivity (India)** | QR-coded reflective collars; the caregiver gets pinged on WhatsApp when someone scans — the proven Indian pattern | [Protect Paws](https://www.protectpaws.in/), [Pawsitivity](https://www.linkedin.com/posts/pawsitivity-save-our-street-animals_pawsitivity-animalwelfare-streetdogs-activity-7478149566031200256-uRAx) |
| **Panchayat.me / civic WhatsApp bots** | One-tap photo+geo reporting *inside WhatsApp*; duplicate merging into threads | [Panchayat](https://panchayat.me/), [WhatsApp civic waste reporting (OSS)](https://github.com/vijitb/whatsapp-civic-waste-reporting) |
| **Waze / WSD volunteer model** | Points accrue but the draw is the *collective* (traffic/territory coverage); a named volunteer manager exists per org | [WSD](https://www.wsdindia.org/) |

### 2.2 WhatsApp is both the competitor and the substrate

- ~531 M WhatsApp users in India (2026) — it *is* the communication layer; most feeder/NGO
  coordination already happens in WhatsApp groups and channels (VOSD runs a daily WhatsApp
  channel for its rescue work). A PWA that demands "open this instead of your group" will be
  ignored. Source: [India social platform stats](https://www.theglobalstatistics.com/india-social-media-statistics/), [VOSD WhatsApp channel](https://www.vosd.in/news/civic-officials-call-mumbai-a-success-story-in-animal-birth-control-as-sterilisation-and-vaccination-rates-cross-65-bringing-rabies-deaths-down-to-single-digits/).
- Government bodies in India already deliver services over WhatsApp; it is an accepted civic
  channel. Source: [ISB — WhatsApp by governments in India](https://blogs.isb.edu/bhartiinstitute/2025/03/11/whatsapp-use-by-governments-in-india-bridging-governance-and-citizens-through-govtech/).
- **Recommendation:** WhatsApp Business API for (a) SOS fan-out template messages, (b) inbound
  photo/geo sighting reports, (c) lost-dog last-seen broadcasts. The PWA stays the
  identity/ledger/depth layer. This is additive, not a pivot: the `sos_notifications.channel`
  column already anticipates non-PWA channels.

### 2.3 Jio, CGNAT and what it means for the stack

- Jio (and most Indian ISPs) put subscribers behind **CGNAT**; Jio 5G is **IPv6-only on
  transport** in places. Consequence: **no inbound connections to the phone** — no reliable
  long-lived WebSocket fan-out from the device, no P2P mesh. Source: [PureVPN — ISPs using CGNAT](https://www.purevpn.com/blog/top-isps-using-cgnat/), [Anurag Bhatia — Jio 5G IPv6-only](https://anuragbhatia.com/post/2023/02/jio-5g-ipv6-only/), [Anurag Bhatia — India internet challenges](https://anuragbhatia.com/post/2026/07/indian-internet-challenges/).
- **What already holds up:** rate limits keyed to account/device, never IP (INVARIANT 6 — correct,
  since a CGNAT pool shares one IP); offline queue + `flushOnOpen` + `client_uuid` idempotency
  (INVARIANT 5); Service-Worker Background Sync is present but must not be the only path
  (Android battery-saver kills it). Source: [WebSocket vs push guidance](https://websocket.org/guides/use-cases/notifications/).
- **What to add:** FCM/Web Push primary + SMS fallback for SOS (SMS already appears in the
  escalation job for vets); a delivery-receipt metric (schema has `sos_notifications.delivered_at`)
  and a "SOS silenced by the OS" detection — the 8-min escalation must not depend on push being
  delivered.

### 2.4 Monsoon: the collar is a consumable

- Mumbai gets ~4 months of heavy monsoon plus year-round humidity/UV; dogs rub collars against
  walls and railings, and collars snag. TPU Shore 95A (seed data) is a reasonable
  hardware choice, and reflective collars are already deployed at Indian street scale.
  Source: [Protect Paws](https://www.protectpaws.in/).
- **Design consequences:** (1) budget collar replacement at ~1/yr and a `retag` scan type already
  in the enum; (2) the network must function when the collar is gone — photo + `cv_embedding`
  visual-ID sighting flow (M7); (3) QR print robustness: direct laser-etch/labelled TPU, not a
  paper label that waterlogs; (4) monsoon-feeding spikes: the heatmap 7-day window and SOS
  severity already imply this, but plan feed-route rotation when dogs move into flood-safe
  ground.

### 2.5 Devices, bandwidth, language

- The zero-install PWA with a size gate (`apps/scan/scripts/size-gate.mjs`) is right for cheap
  Android + metered data. Keep the budget; make the UI **icon-first and trilingual
  (Marathi/Hindi/English)**; downscale photos client-side (already done, 1280px/0.8).
- Camera-first and GPS-on-demand (the 8 s geo timeout is a good call) — do not block a feed log
  on geolocation permission.
- Internet is not guaranteed (power cuts, communal shutdowns, network fatigue) — every
  write-path must stay offline-first, which is already the design.

### 2.6 Legal and political reality

- The Supreme Court has repeatedly affirmed that **feeding community animals is lawful and that
  ABC is the only legal population-control route** — so the register must never double as a
  "nuisance map" for culling; this is the dual-use core of §3. Source: [SC orders on stray-dog feeding and ABC Rules](https://niyam.ai/blog/sc-stray-dogs-feeding).
- Feeders face real harassment (some residents, society committees, occasionally civic staff).
  The system knows where feeders are and when they feed; that is sensitive (§3.2).

---

## 3. Data ethics & custody

### 3.1 Why the dataset is sensitive even though the subjects are dogs

The sensitivity is **indirect**: the register triangulates (1) **feeding spots** (patterns →
human neighbourhood routines), (2) **feeder identity and behaviour** (`phone_hmac`, `device_token`,
`last_known_geo`, `captured_at`, `feed` scan history), (3) **medical provenance** that could be used
to target dogs for removal, and (4) **group-level facts** about a ward (feeding density, ABC
gaps) that can be weaponised in "stray menace" politics. The geoprivacy literature treats this
class — disaggregate location data that can harm people or groups — as high-risk regardless of
species. Sources: [Brookings — location data of vulnerable populations](https://www.brookings.edu/articles/the-crucial-need-to-secure-the-location-data-of-vulnerable-populations/), [MDPI — group-privacy threats for geodata](https://www.mdpi.com/2220-9964/12/10/393), [arXiv — Privacy risk in GeoData survey](https://arxiv.org/html/2402.03612v2).

### 3.2 Custody recommendations (concrete)

**E1 — Geo-coarsening tiers, iNaturalist-geoprivacy style.**
Store exact points privately; expose only coarsened geometry by role. Model the three tiers
directly on iNaturalist's proven design: *obscured* (true point moved to a random point inside a
~22 × 22 km box; you, the data owner, still see the true point), *private* (no location),
and *trust-granted* (a project/role you trust can request the true point). StrayNet already
coarsens the public profile to ward (`coarsenToWard` in `contracts/geo.ts`) and the heatmap to
200 m cells — extend to a per-role resolution matrix:

| Tier | Sees | Resolution |
|---|---|---|
| Anonymous scanner | public profile | ward only (`dogs.ts` today) |
| Provisional feeder | own feeds only | point for own scans; ward for others |
| Verified feeder (≥ trust 40, SOS) | fanout ring | point in assigned territory / 2 km ring (fanout must query coarse ring, then reveal on ack) |
| Vet | medical-adjacent dogs | point on demand within case SLA |
| BMC / NGO officer | programme metrics | ward aggregates + per-dog ABC/vaccine *status only*, **never** feeder identity |

Sources: [iNaturalist geoprivacy](https://www.inaturalist.org/pages/geoprivacy), [iNaturalist — 1-2-3s of geoprivacy (22×22 km box)](https://www.inaturalist.org/posts/32499-the-1-2-3s-of-geoprivacy), [iNaturalist — trust-granted access](https://www.inaturalist.org/blog/62014-location-location-location).

**E2 — k-anonymity + noise on the public heatmap.**
`heatmap.sql` already returns only cell centroids and filters `status='active'` — add a minimum
cell population (e.g. ≥ 3 dogs, and/or ≥ 5 scans in the window) and consider a small noise
injection on low-density cells so a single dog's feeding route cannot be re-derived from a red
cell. This is the UK-Statistics-Authority "disclosure in combination" lesson applied to cells.
Source: [UK Statistics Authority — ethics of geospatial data](https://uksa.statisticsauthority.gov.uk/publication/ethical-considerations-in-the-use-of-geospatial-data-for-research-and-statistics/pages/3/).

**E3 — Role-scoped materialized views + purpose binding, not ad-hoc queries.**
Build coarse/full projection views per role so that "full point" is never reachable by a public
or feeder query path (defense in depth, not just masking in the route handler). Bind access to
purpose (SOS ack, medical need, ABC reporting) and log every full-geometry read with an audit
row. Source: [W3C — Responsible Use of Spatial Data](https://www.w3.org/TR/responsible-use-spatial/), [Esri — ethics in mapping (minimize data, prevent identification)](https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/ethics-in-mapping).

**E4 — Treat `phone_hmac` as pseudonymous personal data.**
An HMAC with a fixed pepper is deterministic per phone and linkable in practice — under the DPDP
Act 2023 that is personal data, not an anonymisation escape hatch. This means: feeder consent
with purpose + version (schema has `consent_version` — good), data-principal rights (erasure is
already INVARIANT 11), breach notification to the Data Protection Board per the DPDP Rules
(notified Nov 2025), and periodic pepper/device-secret rotation so a leak doesn't become a
phone-number dictionary. Note the Act has no separate "sensitive data" class but lets the
government impose localization on sensitive/critical classes — geolocation-heavy registers should
be treated conservatively regardless. Sources: [EY — DPDP Act & Rules 2025](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023), [Recording Law — DPDP guide](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/india-data-privacy-laws/), [PRS — DPDP Bill analysis](https://prsindia.org/billtrack/digital-personal-data-protection-bill-2023).

**E5 — Publication limits.**
The public surface should be exactly: (a) slug+HMAC profile, (b) k-anonymized heatmap cells,
(c) daily ledger anchors (hashes only). No "recent sightings" list, no bulk export, no
stats-by-feeder, no raw scan feed. Reconsider before adding anything a campaign or a
"dog-bite statistics" journalist could scrape into a per-address map. Source: [Springer — geoprivacy guidelines (pre-release assessment)](https://link.springer.com/article/10.1186/s12942-026-00460-y).

**E6 — Breach runbook (add to `ops/RUNBOOK.md`).**
1. Severity triage by exposure class (points leaked? feeder identities? ledger integrity?).
2. Within the DPDP-notified window, notify the Data Protection Board; template public statement.
3. Rotate `STRAYNET_DEVICE_SECRET` and any HMAC peppers → force re-auth of all feeders.
4. Re-coarsen: flip any exposed exact geometry to tier-0 (ward) until reviewed.
5. Audit trail: all reads of full geometry are logged (E3), so scope the blast radius.
6. Monthly PITR drill already exists (RUNBOOK) — add a "simulated leak" drill.
Source: [EY DPDP breach-notification obligations](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023).

**E7 — Minimisation.** No raw phone numbers (already HMAC-only), strip photo EXIF, cap raw-photo
retention (7-day TTL job exists), don't retain GPS beyond the scan row, and log
`captured_at`-vs-`received_at` skew only as aggregate. Source: [W3C — minimize data](https://www.w3.org/TR/responsible-use-spatial/).

**E8 — Governance.** Stand up a small advisory group (feeders, an NGO, a privacy lawyer) and
publish a plain-language "how your data is (and isn't) used" page — the "do no harm" public
commitment that makes feeders trust the system enough to enable SOS. Source: [Ethical Data Initiative — geospatial "do no harm"](https://ethicaldatainitiative.org/2026/04/20/mapping-crisis-geospatial-data-vulnerability-and-humanitarian-aid/), [UNDP — civic tech principles](https://www.undp.org/asia-pacific/civic-tech).

---

## 4. Volunteer retention

### 4.1 What the research actually says

- **Games/gamification attract; community and recognition retain.** Interview studies of
  Foldit/Eyewire and the broader literature consistently find game elements are not needed to
  attract volunteers but help sustain them over time; retention correlates with community,
  feedback and being valued. Sources: [Bowser et al. — Gamifying Citizen Science](http://gamification-research.org/wp-content/uploads/2013/03/Bowser_Hansen_Preece.pdf), [T&F — Meeting volunteer expectations](https://www.tandfonline.com/doi/full/10.1080/09640568.2020.1853507).
- **Motivations differ by phase.** Initial participation is driven by stimulation/self-direction;
  *retention* by achievement, benevolence and collaboration. Badges/leaderboards serve the
  achievement bucket; stories and social proof serve benevolence/collaboration — you need both.
  Source: [CSTP — Survey of Citizen Science Gaming Experiences](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.500).
- **Points + daily streaks + real-time leaderboards measurably lift engagement** (5-day
  intervention study) — but with two caveats: (1) "crowding out": extrinsic points can erode the
  intrinsic motivation that *keeps* long-term volunteers (PLOS 2025); (2) quantity-based goals
  drive spam/low-quality contributions. Sources: [Do games attract or sustain engagement?](https://www.researchgate.net/publication/262284258_Do_games_attract_or_sustain_engagement_in_citizen_science_a_study_of_volunteer_motivations), [PLOS — intrinsic motivation & crowding out](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0331221), [CSTP — Getting it Right or Being Top Rank](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.101).
- **Power users are not point-chasers.** iNaturalist's own power-user threads push for an
  "impact score" (novel/first/high-priority observations) over raw counts, and the community
  repeatedly asks to *not* turn observation volume into a game. Source: [iNaturalist — power users](https://www.inaturalist.org/journal/charlie/6947-thoughts-on-attracting-and-retaining-power-users), [iNaturalist — gamify accuracy thread](https://forum.inaturalist.org/t/gamify-accuracy-award-value-to-quality-not-just-quantity/14428).
- **Recognition is personal at small scale.** In a city like Mumbai the feeder community is
  thousands, not millions — individual recognition ("Feeder of the ward month", a named thank-you
  in a story) outperforms anonymous global leaderboards. Source: [Circle — belonging over leaderboards](https://circle.so/blog/community-gamification-guide).
- **Duolingo's streak is the archetype but must be forgiveness-aware** for an outdoor, weather- and
  network-constrained activity. Source: [StriveCloud — Duolingo gamification](https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo).

### 4.2 Concrete retention mechanics for StrayNet

1. **Impact moments, not points.** Turn `dog_stories` + photo history into a per-feeder feed:
   "You logged the feed that caught Rosie's maggot wound in time" → healing photo → badge. This is
   the benevolence loop the literature says retains people, and it reuses data already collected.
2. **Streaks with grace.** `streak_days` exists; add a "grace day" (or 48 h window) so a monsoon
   day offline doesn't kill a 90-day streak — punishing network luck destroys the behaviour you
   want.
3. **Offline-first recognition.** Compute badges/milestones client-side or on next sync; never
   gate a reward on connectivity. The volunteer who feeds in a dead zone is exactly the one you
   want to keep.
4. **Quality-weighted trust, non-punitive.** Weight `trust_events` by *validated* scans (AI or
   human pass), not raw volume; allow reversals (schema has `reverses_event_id`); never let a
   score drop look like shaming — frame as "needs verification".
5. **Ward/committee social proof (M8).** Ward leaderboards by *coverage* (wards with complete ABC
   records, low unacked-SOS) rather than personal volume; peer thank-yous; a visible "who fed
   this dog this week" — the collaboration bucket.
6. **Territory ownership.** Verified feeders get named territory ownership (`feeder_territories`
   `is_primary`), the recognition most aligned with how feeders already think ("my dogs, my
   beat").
7. **Mentor tier (M2).** The power ~20% who do most of the work get an *organizer/mentor* tier
   (verify newcomers, moderate stories, lead ward drives) — status + responsibility, the strongest
   retention reward for the long tail.

---

## 5. Ranked recommendations

Scoring: **Impact** = effect on the mission (dogs fed/treated, ecosystem capacity multiplied).
**Effort** = implementation + operations cost. Tiers: **P0** do next (high impact / low–med
effort), **P1** plan for next cycle, **P2** later. Within tier, sorted best first.
Each item: one-line rationale + primary source.

| # | Recommendation | Impact | Effort | Tier |
|---|---|---|---|---|
| R1 | Geo-coarsening tiers + k-anonymity heatmap (E1+E2) | High | Low | P0 |
| R2 | WhatsApp Business API: SOS fan-out + inbound sighting reports (§2.2) | High | Med | P0 |
| R3 | Public scan profile → care conversion CTA (M6) | High | Low | P0 |
| R4 | Lost-dog flow: status='lost' + sighting pinning + shareable flyer + 2 km fan-out (M4) | High | Med | P0 |
| R5 | ABC/NGO handshake: signed import + ward coverage dashboard (M1) | High | Med | P0 |
| R6 | Feeder onboarding + mentorship (buddy) workflow (M2) | High | Low | P0 |
| R7 | Collar lifecycle + "sighting without collar" visual-ID path (M7) | High | Med | P0 |
| R8 | Offline-first recognition: local badge/streak computation with grace days (§4.2.2–3) | High | Low | P0 |
| R9 | Role-scoped materialized views + audit of full-geometry reads (E3) | High | Med | P1 |
| R10 | Breach runbook + DPDP-2025-aligned notification + secret rotation (E6) | High | Med | P1 |
| R11 | Adoption funnel: adoptable flag → screening → home-check → follow-up (M3) | Med | Med | P1 |
| R12 | Quality-weighted trust & leaderboards; non-punitive scoring (§4.2.4) | Med | Med | P1 |
| R13 | Ward care committees: moderation, drive scheduling, coverage leaderboards (M8) | Med | Med | P1 |
| R14 | Impact-moment narrative feed from dog_stories (§4.2.1) | Med | Low | P1 |
| R15 | Marathi/Hindi icon-first UI + low-bandwidth mode (§2.5) | Med | Med | P1 |
| R16 | SOS routing to org capacity (WSD on-site team / ABC vans) with SLA (M5) | Med | Med | P1 |
| R17 | Feeder safety: shielded mode + anonymous scanning tier (E4, §2.6) | Med | Low | P1 |
| R18 | Publication policy page + "how your data is used" (E8) | Med | Low | P1 |
| R19 | Monsoon collar replacement subscription / ward retag drives (M7 ops) | Med | Med | P2 |
| R20 | Post-adoption 30/90-day check-in reminders | Low | Low | P2 |

### P0 — do next

1. **R1 Geo-coarsening tiers + k-anonymity heatmap**
   The single highest-leverage privacy change: exact geometry stays private, every public output
   is coarsened by role, and the heatmap gets a min-cell-population floor so feeding routes
   can't be re-derived. Rationale: turns a dual-use register into a safe one at near-zero
   cost — extend the coarsening that already exists in `contracts/geo.ts` and `heatmap.sql`.
   Source: [iNaturalist geoprivacy](https://www.inaturalist.org/pages/geoprivacy).

2. **R2 WhatsApp Business API for SOS + sightings**
   Meet the ecosystem where it lives. Rationale: 531 M Indian users; feeder/NGO coordination is
   already WhatsApp-native, and Pawsitivity already proves "scan → caregiver WhatsApp ping" is the
   accepted Indian pattern. Source: [ISB — WhatsApp gov usage](https://blogs.isb.edu/bhartiinstitute/2025/03/11/whatsapp-use-by-governments-in-india-bridging-governance-and-citizens-through-govtech/).

3. **R3 Public profile → care conversion CTA**
   A stranger's empathy moment currently dead-ends at a profile. Rationale: one-tap "log sighting /
   request help / adopt / volunteer" on the scan page converts the highest-volume traffic into
   ecosystem capacity. Source: [WSD — adoption/volunteer/donate channels](https://www.wsdindia.org/).

4. **R4 Lost-dog flow**
   `status='lost'` is a dead enum value today. Rationale: displacement is a routine Mumbai failure
   mode (floods/redevelopment); a shareable flyer + last-seen fan-out reuses the existing 2 km
   ring and is cheap. Source: [Citizen Matters — displaced dogs in Mumbai](https://citizenmatters.in/how-to-deal-with-rabid-stray-dogs-in-your-area/).

5. **R5 ABC/NGO handshake**
   StrayNet becomes the shared dashboard the ABC system lacks. Rationale: 434,529 dogs already
   sterilised, ₹23 cr in flight — one signed import + per-ward coverage view makes the register
   the official complement to BMC's programme instead of a parallel silo. Source: [FPJ — ₹23 cr plan](https://www.freepressjournal.in/mumbai/mumbai-bmc-plans-sterilisation-of-45000-stray-dogs-annually-allocates-23-crore-for-control-drive).

6. **R6 Feeder onboarding + mentorship**
   `feeder_territories` + `verification_tier` exist; the human loop doesn't. Rationale: new feeders
   at trust 30 with no mentor is the fastest churn point; a buddy/verify flow is the coordination
   feature that most matches the system's philosophy. Source: [T&F — retention review](https://www.tandfonline.com/doi/full/10.1080/09640568.2020.1853507).

7. **R7 Collar lifecycle + no-collar visual-ID sighting**
   Rationale: monsoon makes collars consumables; the network must survive the collar. Use
   `cv_embedding` + photo for a "sighting without collar" that keeps a dog on the map and triggers
   a re-issue. Source: [Protect Paws — reflective collars](https://www.protectpaws.in/).

8. **R8 Offline-first recognition**
   Rationale: the feeder in the dead zone is the one to retain; badges/streaks computed locally or
   on next sync, with a grace day so network/monsoon luck doesn't erase a streak. Source:
   [Duolingo streak design](https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo).

### P1 — next cycle

9. **R9 Role-scoped views + read audit** — defense-in-depth so full geometry is unreachable
   outside purpose-bound roles. Source: [W3C responsible use](https://www.w3.org/TR/responsible-use-spatial/).
10. **R10 Breach runbook + DPDP-aligned notification** — the register will be probed; be ready.
    Source: [EY DPDP guide](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023).
11. **R11 Adoption funnel** — digitise the screened-adoption process NGOs already run. Source:
    [WSD adoption](https://www.wsdindia.org/).
12. **R12 Quality-weighted trust/leaderboards** — reward validated scans, not volume; avoids
    spam (quantity-based goals are a known gamification failure mode). Source:
    [CSTP — games in citizen science](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.101).
13. **R13 Ward care committees** — the collaboration bucket that retention research says
    sustains volunteers. Source: [CSTP — gaming experiences survey](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.500).
14. **R14 Impact-moment feed** — "you healed Rosie" beats "level 7". Source: [Bowser et al.](http://gamification-research.org/wp-content/uploads/2013/03/Bowser_Hansen_Preece.pdf).
15. **R15 Trilingual icon-first UI + low-bandwidth mode** — accessibility is adoption in
    Mumbai. Source: [DataReportal Digital 2026 India](https://datareportal.com/reports/digital-2026-india).
16. **R16 SOS to org capacity** — fan out to orgs/vans with SLA, not just individual feeders,
    mirroring WSD's on-site model. Source: [WSD on-site first aid](https://www.wsdindia.org/).
17. **R17 Feeder safety / shielded mode** — the register knows where feeders are; offer a
    mode where SOS/heatmap excludes their identities. Source: [Brookings — vulnerable-population location data](https://www.brookings.edu/articles/the-crucial-need-to-secure-the-location-data-of-vulnerable-populations/).
18. **R18 Publication policy page** — the "do no harm" commitment that earns feeder trust to
    opt into SOS. Source: [Ethical Data Initiative](https://ethicaldatainitiative.org/2026/04/20/mapping-crisis-geospatial-data-vulnerability-and-humanitarian-aid/).

### P2 — later

19. **R19 Monsoon collar replacement / retag drives** — operationalise consumable collars.
    Source: [Protect Paws](https://www.protectpaws.in/).
20. **R20 Post-adoption check-ins** — 30/90-day nudges keep `status='adopted'` honest and
    improve rehoming outcomes. Source: [WSD adoption programme](https://www.wsdindia.org/).

---

## 6. Primary source list

**India / real-world.** BMC census 90,757 & ABC:
[HT](https://www.hindustantimes.com/cities/mumbai-news/90757-stray-dogs-in-mumbai-birth-control-measures-to-be-expedited-maha-101765308162813.html),
[TOI census launch](https://timesofindia.indiatimes.com/city/mumbai/bmc-launches-stray-dog-census/articleshow/106942158.cms),
[TOI 57/day & rabies drop](https://timesofindia.indiatimes.com/city/mumbai/mumbai-sterilises-57-street-dogs-every-day-sees-drop-in-stray-numbers-and-rabies-cases/articleshow/123370398.cms),
[FPJ ₹23 cr / 434,529](https://www.freepressjournal.in/mumbai/mumbai-bmc-plans-sterilisation-of-45000-stray-dogs-annually-allocates-23-crore-for-control-drive),
[VOSD ABC success + WhatsApp channel](https://www.vosd.in/news/civic-officials-call-mumbai-a-success-story-in-animal-birth-control-as-sterilisation-and-vaccination-rates-cross-65-bringing-rabies-deaths-down-to-single-digits/),
[AWBI ABC handbook](https://awbi.gov.in/uploads/regulations/174073561494ABC_HandBook.pdf),
[AWBI revised ABC guidelines](https://awbi.gov.in/uploads/documents/175508789397Revised%20ABC%20Guidelines.pdf).
Shimla collars: [Times Now](https://www.timesnownews.com/india/first-of-its-kind-gps-enabled-collars-vaccination-drive-for-stray-dogs-in-himachal-pradeshs-shimla-article-152512787),
[CurlyTales](https://curlytales.com/india/ct-scoop/stray-dogs-in-shimla-to-be-fitted-with-gps-collars-and-qr-codes-in-a-first-of-its-kind-initiative/).
QR collars: [Protect Paws](https://www.protectpaws.in/),
[Pawsitivity](https://www.linkedin.com/posts/pawsitivity-save-our-street-animals_pawsitivity-animalwelfare-streetdogs-activity-7478149566031200256-uRAx).
WhatsApp: [India platform stats](https://www.theglobalstatistics.com/india-social-media-statistics/),
[ISB gov WhatsApp](https://blogs.isb.edu/bhartiinstitute/2025/03/11/whatsapp-use-by-governments-in-india-bridging-governance-and-citizens-through-govtech/),
[Panchayat.me](https://panchayat.me/),
[WhatsApp civic waste (OSS)](https://github.com/vijitb/whatsapp-civic-waste-reporting).
Network: [PureVPN CGNAT ISPs](https://www.purevpn.com/blog/top-isps-using-cgnat/),
[Anurag Bhatia — Jio 5G IPv6-only](https://anuragbhatia.com/post/2023/02/jio-5g-ipv6-only/),
[Anurag Bhatia — India internet challenges](https://anuragbhatia.com/post/2026/07/indian-internet-challenges/),
[WebSocket vs push](https://websocket.org/guides/use-cases/notifications/).
WSD: [wsdindia.org](https://www.wsdindia.org/).
SC feeding orders: [niyam.ai](https://niyam.ai/blog/sc-stray-dogs-feeding).
Digital: [DataReportal Digital 2026 India](https://datareportal.com/reports/digital-2026-india).

**Data ethics / geoprivacy.** [iNaturalist geoprivacy](https://www.inaturalist.org/pages/geoprivacy),
[1-2-3s of geoprivacy](https://www.inaturalist.org/posts/32499-the-1-2-3s-of-geoprivacy),
[trust-granted coordinates](https://www.inaturalist.org/blog/62014-location-location-location),
[clarifying geoprivacy / taxon auto-obscure](https://forum.inaturalist.org/t/clarifying-geoprivacy-reasons-for-obscured-coordinates-user-to-user-trust/730),
[Springer geoprivacy guidelines](https://link.springer.com/article/10.1186/s12942-026-00460-y),
[W3C responsible use of spatial data](https://www.w3.org/TR/responsible-use-spatial/),
[Esri ethics in mapping](https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/ethics-in-mapping),
[Brookings — vulnerable populations](https://www.brookings.edu/articles/the-crucial-need-to-secure-the-location-data-of-vulnerable-populations/),
[MDPI — group-privacy threats](https://www.mdpi.com/2220-9964/12/10/393),
[arXiv — GeoData privacy survey](https://arxiv.org/html/2402.03612v2),
[UK Statistics Authority — geospatial ethics](https://uksa.statisticsauthority.gov.uk/publication/ethical-considerations-in-the-use-of-geospatial-data-for-research-and-statistics/pages/3/),
[Ethical Data Initiative — mapping crisis](https://ethicaldatainitiative.org/2026/04/20/mapping-crisis-geospatial-data-vulnerability-and-humanitarian-aid/).
DPDP: [EY DPDP Act & Rules 2025](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023),
[Recording Law DPDP guide](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/india-data-privacy-laws/),
[PRS — Bill analysis](https://prsindia.org/billtrack/digital-personal-data-protection-bill-2023),
[Matters.ai DPDP](https://www.matters.ai/compliance/dpdp/dpdp-act-2023).

**Retention / gamification.** [Bowser, Hansen & Preece — Gamifying Citizen Science](http://gamification-research.org/wp-content/uploads/2013/03/Bowser_Hansen_Preece.pdf),
[T&F — Meeting volunteer expectations](https://www.tandfonline.com/doi/full/10.1080/09640568.2020.1853507),
[CSTP — Getting it Right or Being Top Rank](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.101),
[CSTP — Survey of gaming experiences](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.500),
[Do games attract or sustain engagement (points/streaks/leaderboards)](https://www.researchgate.net/publication/262284258_Do_games_attract_or_sustain_engagement_in_citizen_science_a_study_of_volunteer_motivations),
[PLOS — intrinsic motivation & crowding out](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0331221),
[SciStarter — iNat/Foldit/Phylo retention](https://blog.scistarter.org/2020/11/leveling-up-citizen-science-with-gamification/),
[iNaturalist — power users](https://www.inaturalist.org/journal/charlie/6947-thoughts-on-attracting-and-retaining-power-users),
[iNaturalist — gamify accuracy thread](https://forum.inaturalist.org/t/gamify-accuracy-award-value-to-quality-not-just-quantity/14428),
[iNaturalist — 1,000,000 observers](https://www.inaturalist.org/blog/35758-we-ve-reached-1-000-000-observers),
[StriveCloud — Duolingo streaks](https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo),
[Circle — community gamification](https://circle.so/blog/community-gamification-guide).

---

*Next steps suggested: review §5 P0 set against the blueprint roadmap; treat R1–R3 as a
single "privacy + WhatsApp + conversion" workstream; prototype R4 lost-dog fan-out reusing
`sos_fanout.sql`.*
