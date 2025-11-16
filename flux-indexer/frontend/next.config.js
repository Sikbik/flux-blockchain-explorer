/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'out',
  images: {
    unoptimized: true,
  },
  // Disable automatic static optimization to ensure proper hydration
  reactStrictMode: true,
}

module.exports = nextConfig
