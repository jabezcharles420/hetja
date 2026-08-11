const SLUG_RE = /^[a-z2-7]{9}$/;

export function parseSlug(pathname: string): string {
  const m = /^\/d\/([a-z2-7]{9})\/?/.exec(pathname);
  return m ? m[1] ?? "" : "";
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
