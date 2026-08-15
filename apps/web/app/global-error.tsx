"use client";

/**
 * Last-resort boundary, for a throw in the root layout itself.
 *
 * `app/error.tsx` cannot catch that case — it renders *inside* the layout, so
 * if the layout is what failed there is nothing left to render into. A
 * global-error boundary replaces the whole document, which is why it must
 * supply its own <html> and <body>.
 *
 * It should almost never be seen. It exists because the alternative for a
 * layout-level failure is a completely blank page with no text at all.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "3rem 1.25rem",
          fontFamily: "system-ui, sans-serif",
          color: "#14161a",
          background: "#fff",
        }}
      >
        <main style={{ maxWidth: "34rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Hetja could not load
          </h1>
          <p style={{ margin: "0 0 1.25rem", lineHeight: 1.55 }}>
            Something failed before the page could be built. If you are trying to help
            an animal right now, the collar page still works — scan the QR on the collar
            again, or call a vet directly.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "48px",
              padding: "0 1.25rem",
              border: "1px solid #14161a",
              background: "#14161a",
              color: "#fff",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: "2rem", fontSize: "0.8125rem", color: "#6b7280" }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
