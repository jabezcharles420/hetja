import type { DogProfile, MedicalRecord } from "@/lib/api";
import { dogPhotoUrl } from "@/lib/api";
import PawIllustration from "./PawIllustration";
import styles from "./DogCard.module.css";

export interface DogCardProps {
  dog: DogProfile;
  records?: MedicalRecord[];
}

const STATUS_TONES: Record<NonNullable<DogProfile["status"]>, string> = {
  active: styles.verified,
  lost: styles.lost,
  adopted: styles.abcDone,
  relocated: styles.abcDone,
  deceased: styles.neutral,
};

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
            <PawIllustration size={96} className={styles.paw} />
            <span className={styles.photoCaption}>
              This dog hasn&apos;t been photographed yet.
            </span>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h1 className={styles.name}>{dog.name ?? "Unnamed stray"}</h1>
          <span className={styles.wardPill}>Ward {dog.wardId}</span>
        </div>
        <p className={styles.slug}>#{dog.slug}</p>

        <div className={styles.statusRow}>
          <span className={`${styles.pill} ${STATUS_TONES[dog.status]}`}>
            {capitalize(dog.status)}
          </span>
          {hasAbc && <span className={`${styles.pill} ${styles.abcDone}`}>ABC done</span>}
          {vaccine && (
            <span className={`${styles.pill} ${styles.verified}`}>
              Vaccinated · {vaccine.vaccine_name}
            </span>
          )}
        </div>

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
