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
    ],
  },
};

export default nextConfig;
