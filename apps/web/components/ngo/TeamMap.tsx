import { ESRI_BASE } from "@/components/map/tiles";
import type { DispatchCandidate } from "./ngo-api";
import styles from "./TeamMap.module.css";

/**
 * N3's map: the dog and whoever on the team shared a spot, on a static
 * block of basemap tiles (the same Esri source and no-library approach as
 * the P10 SpotMap: this screen is opened in a hurry, often on a weak
 * signal). Without a key or a point it is the board's plain panel.
 */

const ESRI_KEY = process.env.NEXT_PUBLIC_ESRI_API_KEY ?? "";
const Z = 15;
const TILE = 512;

function project(lat: number, lng: number): { x: number; y: number } {
  const n = 2 ** Z;
  const x = ((lng + 180) / 360) * n * TILE;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * TILE;
  return { x, y };
}

function initial(name: string): string {
  const n = name.replace(/^Dr\.?\s+/i, "").trim();
  return (n[0] ?? "?").toUpperCase();
}

export function TeamMap({
  lat,
  lng,
  dogName,
  team,
}: {
  lat: number | null;
  lng: number | null;
  dogName: string | null;
  team: DispatchCandidate[];
}): React.JSX.Element {
  const caption = `Map · ${dogName ?? "The dog"} and your team`;
  if (lat === null || lng === null) {
    return (
      <div className={styles.map} role="img" aria-label={caption}>
        <span className={styles.caption}>{caption}</span>
      </div>
    );
  }
  const c = project(lat, lng);
  const tx = Math.floor(c.x / TILE);
  const ty = Math.floor(c.y / TILE);
  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  for (let dx = -1; ESRI_KEY && dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      tiles.push({
        key: `${tx + dx}-${ty + dy}`,
        src: `${ESRI_BASE}/tile/${Z}/${ty + dy}/${tx + dx}?token=${encodeURIComponent(ESRI_KEY)}`,
        left: (tx + dx) * TILE - c.x,
        top: (ty + dy) * TILE - c.y,
      });
    }
  }
  const pins = team
    .filter((m) => typeof m.lat === "number" && typeof m.lng === "number")
    .map((m) => {
      const p = project(m.lat!, m.lng!);
      return { m, dx: p.x - c.x, dy: p.y - c.y };
    })
    .filter((p) => Math.abs(p.dx) < 190 && Math.abs(p.dy) < 110);

  return (
    <div className={styles.map} role="img" aria-label={caption}>
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
      {pins.map(({ m, dx, dy }) => (
        <span
          key={m.id}
          className={`${styles.member} ${m.busy ? styles.memberBusy : ""}`}
          style={{ left: `calc(50% + ${dx}px)`, top: `calc(50% + ${dy}px)` }}
          aria-hidden="true"
        >
          {m.kind === "ambulance" ? "+" : initial(m.name)}
        </span>
      ))}
      <span className={styles.dog} aria-hidden="true" />
      <span className={styles.caption}>{caption}</span>
      {ESRI_KEY && <span className={styles.attr}>Powered by Esri</span>}
    </div>
  );
}
