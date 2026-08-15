import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

const adminRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const createNextConfig = (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  outputFileTracingRoot: adminRoot,
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons']
  }
});

export default createNextConfig;
