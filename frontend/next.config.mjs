/** @type {import('next').NextConfig} */
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
        source: '/api/:path*',
        destination: 'http://localhost:5001/:path*', // Changed to port 5001
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
