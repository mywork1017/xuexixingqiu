import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: adminRoot,
  experimental: {
    serverActions: {
      bodySizeLimit: '8mb'
    }
  }
};

export default nextConfig;
