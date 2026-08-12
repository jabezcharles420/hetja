import Link from "next/link";
import Logo from "./Logo";

export default function Footer(): React.JSX.Element {
  return (
    <footer className="h-footer">
      <div className="h-container h-footer-inner">
        <Logo href="/" small />
        <p className="h-footer-muted">
          Every street has a hero — the feeders, vets, and neighbours who show
          up for Mumbai&rsquo;s stray dogs.
        </p>
        <nav className="h-footer-links" aria-label="Footer">
          <Link href="/scan">Scan a collar</Link>
          <Link href="/login">Become a feeder</Link>
          <Link href="/me">My streak</Link>
        </nav>
      </div>
    </footer>
  );
}
