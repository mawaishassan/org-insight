/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:8080/api/:path*' }, 
      
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
