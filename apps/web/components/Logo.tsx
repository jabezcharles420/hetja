import Link from "next/link";

interface LogoProps {
  href?: string;
  small?: boolean;
}

export default function Logo({ href, small }: LogoProps): React.JSX.Element {
  const inner = (
    <>
      <svg
        className="h-logo-mark"
        viewBox="0 0 48 48"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="24" cy="24" r="23" fill="none" stroke="var(--h-ink)" strokeWidth="2" />
        <g fill="var(--h-ink)">
          <circle cx="16.5" cy="18" r="4" />
          <circle cx="24" cy="14.5" r="4.2" />
          <circle cx="31.5" cy="18" r="4" />
          <path d="M15.5 28.5c0-5 3.6-7.5 8.5-7.5s8.5 2.5 8.5 7.5c0 4.4-3.4 6.5-8.5 6.5s-8.5-2.1-8.5-6.5Z" />
        </g>
      </svg>
      <span>Hetja</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={small ? "h-logo h-logo-small" : "h-logo"}>
        {inner}
      </Link>
    );
  }

  return <div className={small ? "h-logo h-logo-small" : "h-logo"}>{inner}</div>;
}
