import styles from "./SpotMap.module.css";

/**
 * P10's map: the exact spot, shown only to the responder who took the case
 * (the API sends `location` to the acker alone). A static 3 x 3 block of
 * CARTO light tiles centred on the point, a red pin, and a Directions link
 * that hands off to the phone's maps app. No map library: this screen is
 * opened from a push, often on a weak signal.
 */

const Z = 17;
const TILE = 256;

function project(lat: number, lng: number): { x: number; y: number } {
  const n = 2 ** Z;
  const x = ((lng + 180) / 360) * n * TILE;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * TILE;
  return { x, y };
}

export function directionsHref(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

export function SpotMap({ lat, lng }: { lat: number; lng: number }): React.JSX.Element {
  const { x, y } = project(lat, lng);
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = tx + dx;
      const cy = ty + dy;
      const sub = "abcd"[(cx + cy) % 4 >= 0 ? (cx + cy) % 4 : 0];
      tiles.push({
        key: `${cx}-${cy}`,
        src: `https://${sub}.basemaps.cartocdn.com/light_all/${Z}/${cx}/${cy}@2x.png`,
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
            style={{ left: `calc(50% + ${t.left}px)`, top: `calc(50% + ${t.top}px)` }}
          />
        ))}
      </div>
      <span className={styles.label}>Exact spot, shared with you only</span>
      <span className={styles.pin} role="img" aria-label="The exact spot" />
      <a href={directionsHref({ lat, lng })} className={styles.directions} target="_blank" rel="noopener noreferrer">
        Directions
      </a>
      <span className={styles.attr}>© OpenStreetMap © CARTO</span>
    </div>
  );
}
