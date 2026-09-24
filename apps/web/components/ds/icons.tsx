/**
 * Status icons, drawn with the exact paths from the handoff (StatusPill).
 * All share a 16x16 viewBox and use currentColor, so the pill's text colour
 * paints them. The alert "!" is drawn (not typed) so it cannot fall back to a
 * different font's glyph.
 */

export type StatusIconName = "check" | "clock" | "cross" | "alert";

interface IconProps {
  name: StatusIconName;
  size?: number;
  /** Check stroke; the handoff uses 2.2 (2.4 at the 12px small size). */
  strokeWidth?: number;
  className?: string;
}

export function StatusIcon({
  name,
  size = 16,
  strokeWidth,
  className,
}: IconProps): React.JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    "aria-hidden": true as const,
    focusable: false as const,
    className,
    "data-icon": name,
  };

  switch (name) {
    case "check":
      return (
        <svg {...common}>
          <path
            d="M3 8.5l3 3 7-7"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? 2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M8 5v3.2l2 1.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "cross":
      return (
        <svg {...common}>
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M8 4.2v4.6" stroke="var(--h-white)" strokeWidth="2.1" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="1.15" fill="var(--h-white)" />
        </svg>
      );
  }
}
