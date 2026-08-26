# Making a collar

A Hetja collar is a physical object that spends months on a street dog in a
Mumbai monsoon, being rubbed against railings and walls. This document is the
recipe for making one that still scans.

## Material — TPU Shore 95A, laser-etched

Use thermoplastic polyurethane (TPU) at Shore hardness 95A. It is the only
material we have validated for this use. **Never a paper label** — see
`docs/research/RESEARCH-1.md §2.4`: a paper label waterlogs, peels, and is gone
within a week of rain. A TPU tag survives pressure washing.

Etch, do not print with ink. Laser etching cuts the code into the material so
there is no ink to fade or bleed. The QR must remain high-contrast black on
white after etching — the white is the TPU base (`--h-base`), the black is
`--h-ink`, both defined in `packages/design/tokens.css`.

## The QR — Version 5 (37×37) at ECC M

The collar URL is `https://hetja.in/d/` (19 chars) + slug (9) + `?s=` (3) +
unpadded base64url SHA-256 HMAC (43) = **74 characters** of byte-mode data.

- Version 4 at ECC M holds 62 bytes — too small.
- **Version 5 (37×37) at ECC M holds 106 bytes — use that.**
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
ECC M via `qrcode-generator`. `apps/scan` must never import it — INVARIANT 13’s
40 KB budget.

## The printable sheet

`/register/<slug>/print` renders the sheet from `GET /api/v1/registrations/:slug`,
so the signature never appears in a URL bar or browser history and the page
survives reload.

- Cut lines (hairline) at the sheet border.
- The QR (40 × 40 mm).
- The 9-character slug as the **typeable fallback** in `.h-plate` with
  `--h-num-tabular` — a stranger must be able to type it when the QR is dirty.
- Design tokens only (`packages/design/tokens.css`): `--h-ink` modules on
  `--h-base`, and `--h-accent` on the Print button and nowhere else (one accent
  per screen).
- Print CSS: `@media print { @page { margin: 10mm } }`, chrome hidden,
  `print-color-adjust: exact`.

The sheet is served at `/register/<slug>/print`; `ChromeShell.tsx` treats it as
a bare route so no header, bottom nav, or install banner is rendered, and print
CSS hides chrome as a second layer (a fixed bottom nav printed across a collar
sheet is a wasted sheet of TPU).

## Fitting

- Two-finger fit between collar and neck — snug enough not to snag, loose enough
  not to choke.
- Breakaway or elastic section so the dog can free itself if the collar catches.

## Lifespan and replacement

Budget **~1 replacement per year**. The collar is a consumable, not a permanent
implant (see `docs/research/RESEARCH-1.md §2.4`).

A replacement **keeps the slug**. `GET /api/v1/registrations/:slug` returns the
same `collarUrl` forever, so every tag already in the field keeps working. Do
not generate a new slug for a reprint — reprint the same QR.

## Physical verification

After etching, scan the tag with a cheap Android phone’s native camera (not
only a developer iPhone). If it does not decode to
`https://hetja.in/d/<slug>?s=<sig>` byte for byte, re-etch. Playwright test
`apps/web/e2e/collar-print.spec.ts` builds the SVG for a known slug+signature
and asserts `BarcodeDetector` returns the exact URL — no server, no database,
no auth. It is the only thing standing between us and a thousand etched tags
that do not scan.
