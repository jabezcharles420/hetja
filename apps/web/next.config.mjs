/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Dog photos are served from the API origin, not from the Next image
    // optimizer — disable remote-pattern requirement by treating them as
    // unoptimized.
    unoptimized: true,
  },
};

export default nextConfig;
