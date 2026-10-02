/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // jsdom / unpdf / pdf-lib must stay external to the server bundle (native-ish deps).
  serverExternalPackages: ['jsdom', 'unpdf', 'pdf-lib', '@mozilla/readability'],
  // Allow the sandbox / tunnel preview hostnames to talk to the dev server.
  allowedDevOrigins: [
    '*.e2b.app',
    '*.e2b.dev',
    '*.arena.ai',
    '*.vercel.app',
    'localhost:3000',
    '127.0.0.1:3000',
  ],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
