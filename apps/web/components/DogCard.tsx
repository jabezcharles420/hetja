import type { DogProfile } from "@/lib/api";
import { dogPhotoUrl } from "@/lib/api";
import styles from "./DogCard.module.css";

export interface DogCardProps {
  dog: DogProfile;
}

export default function DogCard({ dog }: DogCardProps): React.JSX.Element {
  const photo = dogPhotoUrl(dog);

  return (
    <article className={styles.card} aria-label={`Profile for ${dog.name ?? dog.slug}`}>
      <div className={styles.photoWrap}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.photo} src={photo} alt={`Recent photo of ${dog.name ?? "this dog"}`} />
        ) : (
          <div className={styles.photoPlaceholder}>🐾</div>
        )}
      </div>

      <div className={styles.body}>
        <h1 className={styles.name}>{dog.name ?? "Unnamed stray"}</h1>
        <p className={styles.slug}>
          {dog.slug} · ward {dog.wardId}
        </p>

        <div className={styles.statusRow}>
          <span className={`${styles.badge} ${styles[`status-${dog.status}`] ?? ""}`}>{dog.status}</span>
          {dog.abcStatus && <span className={styles.badge}>{dog.abcStatus}</span>}
        </div>

        {dog.vaccineStatus && (
          <dl className={styles.dl}>
            <dt>Vaccination</dt>
            <dd>{dog.vaccineStatus}</dd>
          </dl>
        )}

        {dog.microStory && <p className={styles.story}>{dog.microStory}</p>}

        {dog.lastSeenAt && (
          <p className={styles.meta}>
            Last seen {new Date(dog.lastSeenAt).toLocaleString()}
          </p>
        )}
      </div>
    </article>
  );
}
