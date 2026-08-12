export interface PawIllustrationProps {
  className?: string;
  size?: number;
  title?: string;
}

export default function PawIllustration({
  className,
  size = 48,
  title,
}: PawIllustrationProps): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <ellipse cx="32" cy="42" rx="15" ry="11" />
      <ellipse cx="15" cy="31" rx="5.5" ry="8" transform="rotate(-18 15 31)" />
      <ellipse cx="27" cy="20" rx="6" ry="9" transform="rotate(-6 27 20)" />
      <ellipse cx="38" cy="20" rx="6" ry="9" transform="rotate(6 38 20)" />
      <ellipse cx="50" cy="31" rx="5.5" ry="8" transform="rotate(18 50 31)" />
    </svg>
  );
}
