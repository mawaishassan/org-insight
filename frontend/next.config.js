/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Must match backend port (start.bat and README use 8080)
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
    ];
  },
  webpack: (config) => {
    // Avoid Watchpack error on Windows when watcher hits C:\swapfile.sys
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules', '**/.git', 'C:\\swapfile.sys', '/swapfile.sys'],
    };
    return config;
  },
};

module.exports = nextConfig;
