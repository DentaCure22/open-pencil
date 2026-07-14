import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const intentLensTurbopackAlias =
  './archive/agent-tooling/intent-lens/src/index.ts'
const intentLensReactTurbopackAlias =
  './archive/agent-tooling/intent-lens/src/intent-lens.tsx'
const storybookReactTurbopackAlias =
  './src/components/runtime/storybook-react-shim.tsx'
const storybookNextjsViteTurbopackAlias =
  './src/components/runtime/storybook-nextjs-vite-shim.ts'
const intentLensRoot = path.join(
  projectRoot,
  'archive/agent-tooling/intent-lens/src'
)
const storybookReactShim = path.join(
  projectRoot,
  'src/components/runtime/storybook-react-shim.tsx'
)
const storybookNextjsViteShim = path.join(
  projectRoot,
  'src/components/runtime/storybook-nextjs-vite-shim.ts'
)

/** @type {import('next').NextConfig} */
const nextConfig = {
  crossOrigin: 'anonymous',
  reactStrictMode: true,
  devIndicators: false,

  // Strip console.log from production builds to reduce bundle size
  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
  },

  // Optimize barrel file imports for faster dev boot and builds
  // This automatically transforms imports like:
  //   import { Check, X } from 'lucide-react'
  // Into:
  //   import Check from 'lucide-react/dist/esm/icons/check'
  //   import X from 'lucide-react/dist/esm/icons/x'
  experimental: {
    // Persistent dev cache ballooned to 50GB+ and caused next-server RSS spikes.
    turbopackFileSystemCacheForDev: false,
    optimizePackageImports: [
      'lucide-react',
      '@tabler/icons-react',
      '@radix-ui/react-icons',
      'date-fns',
      'recharts',
      'framer-motion',
      'cmdk',
      'sonner',
      '@supabase/supabase-js',
      'react-day-picker',
      'react-markdown',
      'remark-gfm',
      'react-hook-form',
      '@hookform/resolvers',
      'zod',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
    ],
  },

  // Turbopack configuration for Cornerstone.js WASM codecs
  // These codecs have conditional requires for 'fs' and 'path' that need browser fallbacks
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      // Provide empty fallbacks for Node.js modules used by Cornerstone WASM codecs
      fs: { browser: './src/lib/empty-module.js' },
      path: { browser: './src/lib/empty-module.js' },
      'intent-lens': intentLensTurbopackAlias,
      'intent-lens/react': intentLensReactTurbopackAlias,
      '@storybook/react': storybookReactTurbopackAlias,
      '@storybook/nextjs-vite': storybookNextjsViteTurbopackAlias,
    },
  },

  // Webpack fallback (for when using --webpack flag)
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'intent-lens': path.join(intentLensRoot, 'index.ts'),
      'intent-lens/react': path.join(intentLensRoot, 'intent-lens.tsx'),
      '@storybook/react': storybookReactShim,
      '@storybook/nextjs-vite': storybookNextjsViteShim,
    }

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      }
    }
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    }
    return config
  },

  async redirects() {
    return [
      {
        source: '/favicon.ico',
        destination: '/favicon-v2.svg',
        permanent: true,
      },
    ]
  },

  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
