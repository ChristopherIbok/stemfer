/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@stemfer/shared'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: 'pub-*.r2.dev' },
    ],
  },
};

export default nextConfig;
