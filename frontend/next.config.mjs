/** @type {import('next').NextConfig} */
const backendOrigin = (process.env.BACKEND_ORIGIN || "http://localhost:5001").replace(/\/$/, "")

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      {
        // Avoid `/api` in production on Vercel (often reserved for platform/API routes).
        source: '/backend/:path*',
        destination: `${backendOrigin}/:path*`,
      },
    ]
  },
  images: {
    domains: ['upload.wikimedia.org', 'www.wabash.edu'],
    unoptimized: true,
  },
  // Add timeout configuration for proxy
  experimental: {
    proxyTimeout: 300000, // 5 minutes
  },
}

export default nextConfig
