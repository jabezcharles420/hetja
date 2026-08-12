import type { DogProfile, MedicalRecord } from "@/lib/api";
import { dogPhotoUrl } from "@/lib/api";
import PawIllustration from "./PawIllustration";
import styles from "./DogCard.module.css";

export interface DogCardProps {
  dog: DogProfile;
  records?: MedicalRecord[];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function DogCard({ dog, records = [] }: DogCardProps): React.JSX.Element {
  const photo = dogPhotoUrl(dog);
  const vaccine = records.find((r) => r.vaccine_name);
  const hasAbc = records.some((r) => r.abc_date);

  return (
    <article className={styles.card} aria-label={`Profile for ${dog.name ?? dog.slug}`}>
      <div className={styles.photoWrap}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.photo} src={photo} alt={`Recent photo of ${dog.name ?? "this dog"}`} />
        ) : (
          <div className={styles.photoPlaceholder}>
            <PawIllustration size={72} className={styles.paw} />
            <span className={styles.photoCaption}>
              This dog hasn&apos;t been photographed yet.
            </span>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <h1 className={styles.name}>{dog.name ?? "Unnamed stray"}</h1>

        {/* The signature element: the collar code, set like a signage plate. */}
        <p className={`h-plate ${styles.plate}`}>{dog.slug}</p>

        {dog.wardId && <p className={styles.ward}>Ward {dog.wardId}</p>}

        <ul className={styles.statusList}>
          <li className={styles.statusRow}>
            <span className={styles.statusLabel}>{capitalize(dog.status)}</span>
          </li>
          {hasAbc && (
            <li className={styles.statusRow}>
              <span className={styles.check} aria-hidden="true">
                ✓
              </span>
              <span className={styles.statusLabel}>ABC done</span>
            </li>
          )}
          {vaccine && (
            <li className={styles.statusRow}>
              <span className={styles.check} aria-hidden="true">
                ✓
              </span>
              <span className={styles.statusLabel}>{`Vaccinated · ${vaccine.vaccine_name}`}</span>
            </li>
          )}
        </ul>

        {dog.microStory && (
          <div className={styles.storyCard}>
            <span className={styles.storyKicker}>A note from the street</span>
            <p className={styles.story}>{dog.microStory}</p>
          </div>
        )}

        {dog.lastSeenAt && (
          <p className={styles.meta}>Last seen {new Date(dog.lastSeenAt).toLocaleString()}</p>
        )}
      </div>
    </article>
  );
}
