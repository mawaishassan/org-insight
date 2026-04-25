/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Proxy browser `/api/*` to FastAPI. Use the same port as your uvicorn (start.bat uses 8080).
    // Set NEXT_PUBLIC_BACKEND_URL or NEXT_PUBLIC_API_URL if the backend is not on the default.
    const backendUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:8080';
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
