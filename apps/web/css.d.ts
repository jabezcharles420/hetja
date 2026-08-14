/**
 * Side-effect stylesheet imports, for TypeScript 7.
 *
 * TS 7 added TS2882 — "Cannot find module or type declarations for side-effect
 * import" — which makes `import "./globals.css"` in `app/layout.tsx` an error
 * unless something declares the module. Next 14's own types (pulled in by
 * `next-env.d.ts`) declare `*.module.css` for CSS Modules but do not cover a
 * bare global stylesheet import, so this file supplies it.
 *
 * Deliberately NOT `declare module "*.css": any`-style typing for everything:
 * `*.module.css` is a more specific pattern than `*.css`, so Next's own
 * declaration still wins for `styles.section` lookups and CSS Modules keep
 * their `{ readonly [key: string]: string }` typing. This only fills the gap
 * for stylesheets imported purely for their side effect.
 *
 * Found by a dependabot PR that bumped `apps/web` from `typescript@5.4.5` to
 * `^7.0.2`. Every other package in the workspace was already on 7 — apps/web
 * was the last one on 5, so it was the only place this error could hide. Rather
 * than pin it back to 5, the version is aligned and the declaration added,
 * because the rest of the repo has been type-checked by 7 for a while and a
 * single package on a different major is how you get errors that only appear in
 * CI.
 */
declare module "*.css";
