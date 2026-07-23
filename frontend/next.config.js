/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone helps Docker; Vercel uses its own Next.js output handling.
  output: process.env.VERCEL ? undefined : 'standalone',
  reactStrictMode: true,
  async rewrites() {
    // Static leadership build serves /data/snapshots — do not proxy to a backend.
    if (process.env.NEXT_PUBLIC_DATA_MODE === 'static') {
      return [];
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
