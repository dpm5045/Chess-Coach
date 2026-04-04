import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.216"],
  // Empty turbopack config to opt into Turbopack (Next.js 16 default)
  // The Stockfish worker loads via importScripts from public/, so no bundler config needed
  turbopack: {},
};

export default nextConfig;
