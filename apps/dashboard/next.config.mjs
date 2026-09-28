/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval required by Next.js dev
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              "connect-src 'self' https://arb1.arbitrum.io https://sepolia-rollup.arbitrum.io https://facilitator.payai.network",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
  // Docs live on the landing site (fumadocs, apps/landing/content/docs).
  async redirects() {
    const docsUrl = (process.env.NEXT_PUBLIC_DOCS_URL || 'https://chainpe.app/docs').replace(/\/$/, '')
    return [
      { source: '/docs', destination: docsUrl, permanent: false },
      { source: '/docs/:path*', destination: `${docsUrl}/:path*`, permanent: false },
    ]
  },
}

export default nextConfig
