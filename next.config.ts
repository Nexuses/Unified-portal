import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // CDN hostname can resolve to NAT64/private IPs in some networks;
    // without this, next/image optimization blocks the logo.
    dangerouslyAllowLocalIP: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn-nexlink.s3.us-east-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "nexuseslink2024.s3.us-east-2.amazonaws.com",
      },
    ],
  },
  async rewrites() {
    return [
      { source: "/t/o/:token", destination: "/api/campaigns/track/open/:token" },
      { source: "/t/c/:token", destination: "/api/campaigns/track/click/:token" },
      { source: "/t/u/:token", destination: "/unsubscribe/:token" },
    ];
  },
};

export default nextConfig;
