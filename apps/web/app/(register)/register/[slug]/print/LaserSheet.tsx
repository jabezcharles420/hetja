/**
 * The laser sheet for a TPU tag (live capture 40, "stays as it is" in design
 * v6 P5): printed only, never shown on screen. One 40 x 40 mm QR (version 5,
 * ECC M, 0.889 mm per module with the quiet zone inside), the code as the
 * typeable fallback, the signed URL and the module arithmetic as a self-check
 * for the print shop, and the material note. Only the code's display changed:
 * upper case in three groups, as everywhere else.
 */

import { useMemo } from "react";
import { buildCollarQrSvg, QR_PHYSICAL_SIZE_MM } from "@/lib/qr";
import { prettyCode } from "@/lib/dog-copy";
import styles from "./laser.module.css";

export const LASER_NOTE = "Laser-etch onto TPU Shore 95A, 40×40 mm. Cut on the hairlines.";

export default function LaserSheet({
  slug,
  ward,
  collarUrl,
}: {
  slug: string;
  ward: string;
  collarUrl: string;
}): React.JSX.Element {
  const qr = useMemo(() => buildCollarQrSvg(collarUrl), [collarUrl]);
  return (
    <div className={styles.sheet} data-laser-sheet="true" aria-hidden="true">
      <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr.svg }} />
      <p className={styles.plate}>{prettyCode(slug)}</p>
      <p className={styles.meta}>
        Ward {ward} · {prettyCode(slug)} · {collarUrl}
      </p>
      <p className={styles.selfCheck}>
        {qr.label} · {qr.moduleMm.toFixed(3)} mm/module at {QR_PHYSICAL_SIZE_MM} mm · Do not scale below 100%
      </p>
      <p className={styles.note}>{LASER_NOTE}</p>
    </div>
  );
}
