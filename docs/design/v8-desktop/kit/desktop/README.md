# Hetja desktop UI kit (1440)

Replaces the Stitch "Municipal Stray Network" map mock (uploads/stitch_hetja_design_system) with the repo's own system: the map handoff (docs/design/v4-handoff/map, v6 M1–M7) and the v6 D1 desktop invitation.

- **Map**: a 420px white left panel (city view, then ward view), mist canvas with ward pills at ward centres, vet "+" and NGO "N" pins, four icon-plus-word filter chips, one blue button ("I can go and help" when a ward has an open case nobody is on, otherwise "Get alerts for {ward} ward"). No street addresses, no street tiles (shows the repo's honest fallback line).
- **Invitation**: "Hetja lives on your phone." with a QR slot, today's count and the example dog page.

Changed from the Stitch mock: no Material Symbols, no red action outside SOS, no invented "NFC mesh / BMC sync" copy, location kept ward-level, no em dashes, SF/Inter stack instead of the Material 3 palette.
