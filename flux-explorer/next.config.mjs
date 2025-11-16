/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker
  output: 'standalone',

  // Enable instrumentation for server initialization hooks
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
