"use client";

/**
 * Route-level error boundary.
 *
 * There was none anywhere in this app. Every page is a client component, so any
 * unhandled throw during render unmounted the entire tree and left the user on
 * Next.js's production fallback — a white page reading "Application error: a
 * client-side exception has occurred", with no message, no retry, and no way
 * back.
 *
 * That is not a hypothetical. `/me` threw on every render for every signed-in
 * feeder because the streak payload was missing a field the page mapped over,
 * so a login that had just succeeded ended on a blank error screen. The
 * underlying bug is fixed; this exists so the next one costs a user a screen
 * rather than the session.
 *
 * Deliberately plain: no accent colour, no illustration, and the same fixed
 * vocabulary as the rest of the app. An error screen is a wayfinding problem —
 * say what happened, give exactly one way forward, and do not decorate it.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <main
      style={{
        maxWidth: "34rem",
        margin: "0 auto",
        padding: "3rem 1.25rem",
        fontFamily: "var(--h-font, system-ui, sans-serif)",
        color: "var(--h-ink, #14161a)",
      }}
    >
      <h1 style={{ fontSize: "1.375rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
        Something went wrong on this page
      </h1>
      <p style={{ margin: "0 0 1.25rem", lineHeight: 1.55 }}>
        The rest of Hetja is still working. You can try this page again, or go back to
        the home screen.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: "48px",
            padding: "0 1.25rem",
            border: "1px solid var(--h-ink, #14161a)",
            background: "var(--h-ink, #14161a)",
            color: "#fff",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <a
          href="/"
          style={{
            minHeight: "48px",
            display: "inline-flex",
            alignItems: "center",
            padding: "0 1.25rem",
            border: "1px solid var(--h-rule, #d7dbe0)",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          Home
        </a>
      </div>

      {/*
        The digest is Next.js's server-side correlation id. It is the only thing
        that makes a user's report actionable ("it broke" versus "it broke,
        digest a1b2c3"), and it exposes nothing about the error itself.
      */}
      {error.digest ? (
        <p
          style={{
            marginTop: "2rem",
            fontSize: "0.8125rem",
            color: "var(--h-ink-muted, #6b7280)",
          }}
        >
          Reference: <code>{error.digest}</code>
        </p>
      ) : null}
    </main>
  );
}
