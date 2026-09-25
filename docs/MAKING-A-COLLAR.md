# Making a collar

A Hetja collar is a physical object that spends months on a street dog in a
Mumbai monsoon, being rubbed against railings and walls. This document is the
recipe for making one that still scans.

## Material: TPU Shore 95A, laser-etched

Use thermoplastic polyurethane (TPU) at Shore hardness 95A. It is the only
material we have validated for this use. **Never a paper label**; see
`docs/research/RESEARCH-1.md §2.4`: a paper label waterlogs, peels, and is gone
within a week of rain. A TPU tag survives pressure washing.

Etch, do not print with ink. Laser etching cuts the code into the material so
there is no ink to fade or bleed. The QR must remain high-contrast black on
white after etching. The white is the TPU base (`--h-base`), the black is
`--h-ink`, both defined in `packages/design/tokens.css`.

## The QR: Version 5 (37×37) at ECC M

The collar URL is `https://hetja.in/d/` (19 chars) + slug (9) + `?s=` (3) +
unpadded base64url SHA-256 HMAC (43) = **74 characters** of byte-mode data.

- Version 4 at ECC M holds 62 bytes, which is too small.
- **Version 5 (37×37) at ECC M holds 106 bytes. Use that.**
- Plus the spec-mandated **4-module quiet zone** each side: 37 + 2×4 = **45
  units across**.

At **40 × 40 mm** that is **0.889 mm per module**, comfortably above the floor
for laser etching and a cheap phone camera to resolve. The sheet prints the
computed module size as a self-check.

ECC L would fit in version 4 with slightly larger modules and is **rejected**:
7 % recovery on a tag that spends four months in a monsoon being rubbed
against railings is the wrong trade. ECC M (15 %) is the minimum.

Render the SVG with `viewBox="0 0 45 45"` and `width="40mm" height="40mm"`, so
the physical size is exact and browser-zoom-independent. One `<rect>` per dark
module or a single merged `<path>` (fewer nodes, better for a slow print
pipeline) are both valid.

**Do not scale below 100 %.** At 30 mm the modules drop to 0.67 mm and start
failing on low-end devices.

Implementation: `apps/web/lib/qr.ts` (`buildCollarQrSvg`) encodes at version 5
ECC M via `qrcode-generator`. `apps/scan` must never import it, because of INVARIANT 13’s
40 KB budget.

## The printable sheet

Design v5 replaced the single etched-tag sheet with printable paper sheets
("Hetja Collar Sheet A4" in `docs/design/v5-handoff/`), made on the phone:

- `/register/<slug>/print` (R7) builds a **vector PDF in the browser**
  (`apps/web/lib/collar-pdf.ts`, pdf-lib) in one of two layouts: ten 32 × 46 mm
  collar tags plus two 150 × 22 mm collar bands, or the wall notice with the
  large QR. A4 or Letter; Letter reflows the same content. `/register/batch`
  (R8) puts up to eight dogs, two tags each, on one A4 page.
- The collar URL comes from `GET /api/v1/dogs/:slug/collar` (falling back to
  `GET /api/v1/registrations/:slug`), or `POST /api/v1/collars/batch` for a
  batch, so the signature never appears in a URL bar.
- Same QR as ever: version 5, ECC M, the signed URL byte for byte. Only the
  printed size changes. The tag QR box is **22 mm including the 4-module quiet
  zone, 0.49 mm per module**; the band draws 18 mm of modules and takes its
  quiet zone from its own 2 mm margin; the notice QR is 68.8 mm. The
  arithmetic is in `apps/web/lib/qr.ts`.
- The code is printed under every QR as the typeable fallback, upper case in
  three groups (`RNI 482 PQ7`).
- Black ink only, **print at 100% scale**; the sheet says so.
- If the phone cannot make the PDF, `/register/<slug>/print/sheet` (and
  `/register/batch/sheet`) is the same sheet as HTML at real millimetres with
  an `@page` rule, for the browser's own Print.

These are paper tags: cut, laminate or seal both sides in clear packing tape,
and replace them when they wear. The laser-etched TPU tag is still the
long-lived option: design v6 P5's material switch ("Laser on TPU" on the same
print screen) prints its 40 × 40 mm sheet unchanged, with the shop's specs one
tap away, and the 40 mm arithmetic above still applies to it.

## Fitting

- Two-finger fit between collar and neck: snug enough not to snag, loose enough
  not to choke.
- Breakaway or elastic section so the dog can free itself if the collar catches.

## Lifespan and replacement

Budget **~1 replacement per year**. The collar is a consumable, not a permanent
implant (see `docs/research/RESEARCH-1.md §2.4`).

A replacement **keeps the slug**. `GET /api/v1/registrations/:slug` returns the
same `collarUrl` forever, so every tag already in the field keeps working. Do
not generate a new slug for a reprint; reprint the same QR.

## Physical verification

After etching, scan the tag with a cheap Android phone’s native camera (not
only a developer iPhone). If it does not decode to
`https://hetja.in/d/<slug>?s=<sig>` byte for byte, re-etch. Playwright test
`apps/web/e2e/collar-print.spec.ts` builds the SVG for a known slug+signature
and asserts `BarcodeDetector` returns the exact URL, at the etched 40 mm and at
the A4 sheet's 22 mm tag and 18 mm band inside their outlines, with no server,
no database, no auth. It is the only thing standing between us and a thousand etched tags
that do not scan.
