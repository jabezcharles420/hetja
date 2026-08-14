/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next build` on this box's 2 GB VPS, run alongside the already-live API,
  // worker and scan services, previously OOM-killed the web app mid-build.
  // The fix is to stop building here at all: CI (GitHub Actions) runs
  // `next build` on its own runner and ships the result over rsync, so the
  // VPS only ever has to *run* pre-built output, never compile it.
  // `output: 'standalone'` is what makes that possible — it traces the
  // actual runtime dependency graph and emits a self-contained
  // `.next/standalone/` bundle (a minimal server.js plus only the
  // node_modules it really needs), instead of requiring the full
  // repo + full node_modules on the target machine. See
  // ops/deploy-remote.sh and .github/workflows/deploy.yml for the deploy
  // side of this.
  output: "standalone",
  // `@hetja/pow` ships TypeScript source rather than a built `dist/` — see the
  // header of packages/pow/src/index.ts for why (it keeps
  // `pnpm --filter @hetja/scan build` a single esbuild call with no prerequisite
  // to build first). Next therefore has to compile it like app code; without
  // this line the login page fails to build with a syntax error on the first
  // type annotation it meets, because node_modules is not transpiled by default.
  transpilePackages: ["@hetja/pow"],
  images: {
    // Dog photos are served from the API origin, not from the Next image
    // optimizer — disable remote-pattern requirement by treating them as
    // unoptimized.
    unoptimized: true,
  },
};

export default nextConfig;
