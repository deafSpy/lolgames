/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@multiplayer/shared"],
  // Allow WebSocket connections to the game server
  async rewrites() {
    return [
      {
        source: "/api/game/:path*",
        destination: `${process.env.NEXT_PUBLIC_GAME_SERVER_URL || "http://localhost:3001"}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

