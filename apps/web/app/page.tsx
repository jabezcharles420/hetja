"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function PawArt(): React.JSX.Element {
  return (
    <svg
      className="h-paw-art"
      viewBox="0 0 200 200"
      role="img"
      aria-label="A paw print glowing in amber"
    >
      <g fill="var(--h-amber)">
        <circle cx="72" cy="82" r="16" />
        <circle cx="100" cy="60" r="18" />
        <circle cx="128" cy="82" r="16" />
        <path d="M62 124c0-22 16-34 38-34s38 12 38 34c0 21-15 32-38 32s-38-11-38-32Z" />
      </g>
      <circle cx="36" cy="44" r="4" fill="var(--h-moss)" />
      <circle cx="164" cy="40" r="4" fill="var(--h-moss)" />
      <circle cx="176" cy="112" r="3" fill="var(--h-amber-soft)" />
      <circle cx="24" cy="132" r="3" fill="var(--h-amber-soft)" />
    </svg>
  );
}

function Stat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div>
      <p className="h-stat-value">{value}</p>
      <p className="h-stat-label">{label}</p>
    </div>
  );
}

function Step({
  num,
  title,
  text,
}: {
  num: string;
  title: string;
  text: string;
}): React.JSX.Element {
  return (
    <article className="h-card h-step">
      <span className="h-step-num" aria-hidden="true">
        {num}
      </span>
      <h3 className="h-step-title">{title}</h3>
      <p className="h-step-text">{text}</p>
    </article>
  );
}

export default function LandingPage(): React.JSX.Element {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = slug.trim().toLowerCase();
    if (!/^[a-z2-7]{9}$/.test(trimmed)) {
      setError("Enter the 9-character code from the dog's collar (letters a–z + digits 2–7).");
      return;
    }
    setError(null);
    router.push(`/dog/${trimmed}`);
  };

  return (
    <>
      <section className="h-hero">
        <div className="h-container h-hero-grid">
          <div className="h-hero-fade-up">
            <span className="h-pill h-pill-amber h-hero-kicker">
              Mumbai&rsquo;s street heroes
            </span>
            <h1 className="h-hero-title">Every street has a hero.</h1>
            <p className="h-hero-sub">
              Hetja is a small network of feeders, vets, and neighbours who
              show up for stray dogs across Mumbai. Scan a collar, meet the
              dog, and keep the streak alive.
            </p>
            <div className="h-hero-ctas">
              <Link className="h-btn h-btn-primary" href="/scan">
                Scan a collar
              </Link>
              <Link className="h-btn h-btn-dark" href="/login">
                Become a feeder
              </Link>
            </div>
            <form className="h-code-form" onSubmit={submit}>
              <label className="h-code-hint" htmlFor="collar-code">
                No QR reader? Type the collar code:
              </label>
              <input
                id="collar-code"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. abc234567"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                aria-label="Collar code"
              />
              <button type="submit" className="h-btn h-btn-ghost">
                View profile
              </button>
            </form>
            {error && <p className="h-code-error">{error}</p>}
          </div>

          <div className="h-hero-fade-up h-paw-panel" style={{ animationDelay: "120ms" }}>
            <PawArt />
          </div>
        </div>
      </section>

      <section className="h-stats" aria-label="Impact">
        <div className="h-container h-stats-row">
          <Stat value="—" label="dogs tracked" />
          <Stat value="—" label="feeds logged" />
          <Stat value="—" label="lives touched" />
        </div>
      </section>

      <section className="h-section" id="how-it-works">
        <div className="h-container">
          <div className="h-how-head">
            <span className="h-pill h-pill-amber">How it works</span>
            <h2 className="h-how-title">Three steps to a warmer street.</h2>
            <p className="h-how-sub">
              Every dog has a collar code and a story. Meet them, feed them,
              act.
            </p>
          </div>
          <div className="h-steps">
            <Step
              num="1"
              title="Scan"
              text="Point at the QR on a dog's collar — or type the 9-character code. It's their ID and their whole file."
            />
            <Step
              num="2"
              title="See"
              text="Meet the dog: name, ward, ABC and vaccine status, verified medical records, and a micro-story."
            />
            <Step
              num="3"
              title="Act"
              text="Log a feed, raise an SOS, or keep your streak. Every act is counted and builds your trust score."
            />
          </div>
        </div>
      </section>

      <section className="h-band">
        <div className="h-container h-band-inner">
          <h2 className="h-band-title">
            Be the reason a street dog eats today.
          </h2>
          <p className="h-band-sub">
            Hetja is built by and for Mumbai&rsquo;s street heroes. Create an
            account, claim your patches, and show up tomorrow too.
          </p>
          <Link className="h-btn h-btn-primary" href="/login">
            Become a feeder
          </Link>
        </div>
      </section>
    </>
  );
}
