import { ESRI_BASE } from "@/components/map/tiles";
import styles from "./SpotMap.module.css";

/**
 * P10's map: the exact spot, shown only to the responder who took the case
 * (the API sends `location` to the acker alone). A static 3 x 3 block of
 * basemap tiles centred on the point, a red pin, and a Directions link
 * that hands off to the phone's maps app. No map library: this screen is
 * opened from a push, often on a weak signal.
 */

/** The map's own basemap key (NEXT_PUBLIC_ESRI_API_KEY, inlined at build time). */
const ESRI_KEY = process.env.NEXT_PUBLIC_ESRI_API_KEY ?? "";

/**
 * Esri Light Gray (512 px tiles, so zoom 16 draws at street scale), the same
 * source as /map (components/map/tiles.ts). Without a key there are no tiles:
 * CARTO now answers "API key required", so the pin sits on a plain background
 * and Directions still works, as on /map.
 */
const SOURCE = { z: 16, tile: 512, url: (z: number, x: number, y: number) => `${ESRI_BASE}/tile/${z}/${y}/${x}?token=${encodeURIComponent(ESRI_KEY)}`, attr: "Powered by Esri" };

function project(lat: number, lng: number): { x: number; y: number } {
  const n = 2 ** SOURCE.z;
  const x = ((lng + 180) / 360) * n * SOURCE.tile;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * SOURCE.tile;
  return { x, y };
}

export function directionsHref(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

export function SpotMap({ lat, lng }: { lat: number; lng: number }): React.JSX.Element {
  const { x, y } = project(lat, lng);
  const TILE = SOURCE.tile;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  for (let dx = -1; ESRI_KEY && dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = tx + dx;
      const cy = ty + dy;
      tiles.push({
        key: `${cx}-${cy}`,
        src: SOURCE.url(SOURCE.z, cx, cy),
        left: cx * TILE - x,
        top: cy * TILE - y,
      });
    }
  }
  return (
    <div className={styles.map}>
      <div className={styles.tiles} aria-hidden="true">
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t.key}
            src={t.src}
            alt=""
            width={TILE}
            height={TILE}
            className={styles.tile}
            style={{ width: TILE, height: TILE, left: `calc(50% + ${t.left}px)`, top: `calc(50% + ${t.top}px)` }}
          />
        ))}
      </div>
      <span className={styles.label}>Exact spot, shared with you only</span>
      <span className={styles.pin} role="img" aria-label="The exact spot" />
      <a href={directionsHref({ lat, lng })} className={styles.directions} target="_blank" rel="noopener noreferrer">
        Directions
      </a>
      {ESRI_KEY && <span className={styles.attr}>{SOURCE.attr}</span>}
    </div>
  );
}
