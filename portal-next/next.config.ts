import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // /live is client-only and excluded from static export by using 'use client' + skipMiddlewareUrlNormalize
  trailingSlash: true,
};

export default nextConfig;
