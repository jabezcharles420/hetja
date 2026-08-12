import Link from "next/link";
import Logo from "./Logo";

export default function Header(): React.JSX.Element {
  return (
    <header className="h-header">
      <div className="h-container h-header-inner">
        <Logo href="/" />
        <nav className="h-header-nav" aria-label="Primary">
          <Link href="/scan">Scan</Link>
          <Link href="/login">Log in</Link>
          <Link href="/me">My streak</Link>
        </nav>
      </div>
    </header>
  );
}
