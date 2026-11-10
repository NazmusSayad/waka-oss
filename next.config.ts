import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: { BUILD_ID: String(Date.now()) },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
