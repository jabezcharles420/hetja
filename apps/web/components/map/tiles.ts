import type * as Leaflet from "leaflet";
import { MUMBAI_LATLNG } from "./logic";

/**
 * Base map tiles for /map.
 *
 * Esri Light Gray (the mock's basemap), served by the ArcGIS Location
 * Platform's Static Basemap Tiles service: 512 px raster tiles, so Leaflet
 * needs tileSize 512 with zoomOffset -1. The key is a referrer-restricted
 * browser key with only the basemap privileges; the browser's normal Referer
 * is what authorises it, so no referrerPolicy is set on the tiles. The
 * service's terms require "Powered by Esri" plus the data attribution it
 * returns (GET {style}/static -> copyrightText), which is fetched once and
 * falls back to the text the service documents.
 *
 * Mumbai only: both layers carry `bounds` (Leaflet requests no tile that
 * does not touch the Mumbai box; tiles are 512 px, so the edge tiles still
 * draw up to their own edge) and `noWrap`.
 *
 * Without a key, or when Esri refuses the tiles at runtime (expired or revoked
 * key, 401/498), there is no tile layer at all: the map is a plain mist
 * background and the ward pills and place pins still sit at their centres.
 * There is no keyless fallback. CARTO's light_all now answers 200 with an
 * "API KEY REQUIRED" image (so tileerror never fires), and OpenStreetMap's
 * own tiles are ruled out for a production app by their usage policy.
 */

export const ESRI_BASE =
  "https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/light-gray/static";
const ESRI_POWERED = 'Powered by <a href="https://www.esri.com" rel="noopener">Esri</a>';
const ESRI_DATA_FALLBACK =
  "Esri, TomTom, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community";
/** Esri errors before any tile loads: this many and the key is not working. */
const FAILS_BEFORE_FALLBACK = 3;

/** "none": no street map; MapScreen says so on the map. */
export type TileSource = "esri" | "none";

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function addBaseLayer(
  L: typeof Leaflet,
  map: Leaflet.Map,
  key: string | undefined,
  onSource?: (s: TileSource) => void,
): void {
  const k = (key ?? "").trim();
  if (!k) {
    onSource?.("none");
    return;
  }

  const esri = L.tileLayer(`${ESRI_BASE}/tile/{z}/{y}/{x}?token=${encodeURIComponent(k)}`, {
    tileSize: 512,
    zoomOffset: -1,
    bounds: MUMBAI_LATLNG,
    noWrap: true,
    maxZoom: 16,
    attribution: `${ESRI_POWERED} | ${ESRI_DATA_FALLBACK}`,
  });
  let loaded = 0;
  let failed = 0;
  let swapped = false;
  esri.on("tileload", () => {
    loaded++;
  });
  esri.on("tileerror", () => {
    failed++;
    if (!swapped && loaded === 0 && failed >= FAILS_BEFORE_FALLBACK) {
      swapped = true;
      // Removing the layer also takes its Esri credit out of the attribution.
      map.removeLayer(esri);
      onSource?.("none");
    }
  });
  esri.addTo(map);
  onSource?.("esri");

  // The data attribution the service asks for, when it answers.
  fetch(`${ESRI_BASE}?token=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((meta: { copyrightText?: unknown } | null) => {
      const text = typeof meta?.copyrightText === "string" ? meta.copyrightText.trim() : "";
      if (!text || swapped) return;
      const ctl = map.attributionControl;
      ctl?.removeAttribution(`${ESRI_POWERED} | ${ESRI_DATA_FALLBACK}`);
      const next = `${ESRI_POWERED} | ${escapeText(text)}`;
      esri.options.attribution = next;
      ctl?.addAttribution(next);
    })
    .catch(() => undefined);
}
