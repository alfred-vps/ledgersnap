/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",

  // No image optimization for static export
  images: { unoptimized: true },

  // Disable server-side features
  trailingSlash: true,

  // Environment variables exposed to the client
  env: {
    NEXT_PUBLIC_WORKER_URL: "https://ledgersnap-api.pre-genesis.workers.dev",
  },
};

module.exports = nextConfig;
