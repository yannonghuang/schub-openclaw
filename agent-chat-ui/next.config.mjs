/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // 👇 Tell Next.js it's mounted under /agent-chat-ui
  //basePath: "/agent-chat-ui",
  assetPrefix: "/agent-chat-ui",
};

export default nextConfig;
